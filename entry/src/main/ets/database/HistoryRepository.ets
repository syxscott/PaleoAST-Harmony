/**
 * Analysis history — RDB-backed.
 *
 * One wide table serves every analysis type, so adding a new one never requires
 * a schema migration. Four design points worth keeping:
 *
 *   1. `extra_params` is a JSON escape hatch for type-specific fields (matrix
 *      dimensions, chosen columns, axis bounds). New analyses store their
 *      parameters there instead of getting a new column.
 *   2. A composite index on (analysis_name, timestamp DESC) makes the two
 *      access patterns cheap: "newest N of this analysis" and "newest N of
 *      everything".
 *   3. Silent de-duplication: if the newest record of the same analysis has
 *      identical input, the insert is skipped and the EXISTING id is returned,
 *      so the caller cannot tell the difference and the list never fills with
 *      repeats from a double-tap.
 *   4. Rolling retention: after each insert, only the newest MAX_PER_ANALYSIS
 *      rows per analysis are kept.
 *
 * This is what makes the "GUI operation <-> reproducible script" export
 * survive an app restart; previously the history was an in-memory array that
 * vanished on exit.
 */
import { relationalStore } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import Logger from '../utils/Logger';

/** One recorded analysis run. */
export interface AnalysisRecord {
  id?: number;
  /** Analysis name as it appears in the navigation tree, e.g. 'PCA'. */
  analysisName: string;
  /** JSON of the parameters the dialog supplied. */
  params: string;
  /** Short human-readable summary shown in the history list. */
  resultSummary: string;
  /** Optional full result payload as JSON. */
  resultJson?: string;
  /** Plot type the run produced, so the chart can be restored later. */
  plotType?: string;
  /** Shape of the input matrix at run time, e.g. '48x12'. */
  dataShape?: string;
  /** Millisecond timestamp, used for ordering and de-duplication. */
  timestamp: number;
}

export class HistoryRepository {
  private static readonly STORE_CONFIG: relationalStore.StoreConfig = {
    name: 'PaleoASTHistory.db',
    securityLevel: relationalStore.SecurityLevel.S1
  };

  /** Newest N rows are kept per analysis. */
  private static readonly MAX_PER_ANALYSIS: number = 100;

  private static readonly SQL_CREATE_TABLE: string = `
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_name TEXT NOT NULL,
      params TEXT NOT NULL,
      result_summary TEXT NOT NULL,
      result_json TEXT,
      plot_type TEXT,
      data_shape TEXT,
      timestamp INTEGER NOT NULL
    );
  `;

  private static readonly SQL_CREATE_INDEX: string =
    'CREATE INDEX IF NOT EXISTS idx_analysis_timestamp ON history (analysis_name, timestamp DESC);';

  private static store: relationalStore.RdbStore | null = null;

  /** Initialise the store, create the table and the composite index. */
  public static async init(context: common.Context): Promise<void> {
    if (HistoryRepository.store !== null) {
      return;
    }
    try {
      const store = await relationalStore.getRdbStore(context, HistoryRepository.STORE_CONFIG);
      await store.executeSql(HistoryRepository.SQL_CREATE_TABLE);
      await store.executeSql(HistoryRepository.SQL_CREATE_INDEX);
      HistoryRepository.store = store;
      Logger.info('[HistoryRepository] store and index ready');
    } catch (err) {
      const e = err as Error;
      Logger.error('[HistoryRepository] init failed: ' + e.message);
      throw new Error(e.message);
    }
  }

  public static isReady(): boolean {
    return HistoryRepository.store !== null;
  }

  /**
   * Append a record, skipping it when it repeats the newest one for the same
   * analysis. Returns the row id of the stored (or existing) record, or -1.
   */
  public static async insertRecord(record: AnalysisRecord): Promise<number> {
    const store = HistoryRepository.store;
    if (!store) {
      Logger.error('[HistoryRepository] insert before init; record dropped');
      return -1;
    }
    try {
      // ── Silent de-duplication against the newest row of this analysis ──
      // Asking for a single row (limitAs(1)) and only the two columns we compare
      // keeps this effectively free.
      const probe = new relationalStore.RdbPredicates('history');
      probe.equalTo('analysis_name', record.analysisName);
      probe.orderByDesc('timestamp');
      probe.limitAs(1);
      const existing = await store.query(probe, ['id', 'params']);
      try {
        if (existing.goToFirstRow()) {
          const previousParams = existing.getString(existing.getColumnIndex('params'));
          if (previousParams === record.params) {
            Logger.info('[HistoryRepository] consecutive duplicate suppressed for ' + record.analysisName);
            return existing.getLong(existing.getColumnIndex('id'));
          }
        }
      } finally {
        existing.close();
      }

      const bucket: relationalStore.ValuesBucket = {
        'analysis_name': record.analysisName,
        'params': record.params,
        'result_summary': record.resultSummary,
        'result_json': record.resultJson ?? '',
        'plot_type': record.plotType ?? '',
        'data_shape': record.dataShape ?? '',
        'timestamp': record.timestamp
      };
      const rowId = await store.insert('history', bucket);

      // ── Rolling retention ──
      await store.executeSql(
        'DELETE FROM history WHERE analysis_name = ? AND id NOT IN (' +
        'SELECT id FROM history WHERE analysis_name = ? ORDER BY timestamp DESC LIMIT ?)',
        [record.analysisName, record.analysisName, HistoryRepository.MAX_PER_ANALYSIS]);

      return rowId;
    } catch (err) {
      const e = err as Error;
      Logger.error('[HistoryRepository] insert failed: ' + e.message);
      return -1;
    }
  }

  /**
   * Read records, newest first.
   *
   * @param analysisName exact name, 'all' for everything, or a comma-separated
   *   list such as 'PCA,NMDS' for a multi-select.
   */
  public static async queryRecords(analysisName: string = 'all', limit: number = 50): Promise<AnalysisRecord[]> {
    const store = HistoryRepository.store;
    if (!store) {
      return [];
    }
    try {
      const predicates = new relationalStore.RdbPredicates('history');
      if (analysisName && analysisName !== 'all') {
        if (analysisName.includes(',')) {
          predicates.in('analysis_name', analysisName.split(','));
        } else {
          predicates.equalTo('analysis_name', analysisName);
        }
      }
      predicates.orderByDesc('timestamp');
      if (limit > 0) {
        predicates.limitAs(limit);
      }

      const rs = await store.query(predicates);
      const out: AnalysisRecord[] = [];
      try {
        while (rs.goToNextRow()) {
          out.push({
            id: rs.getLong(rs.getColumnIndex('id')),
            analysisName: rs.getString(rs.getColumnIndex('analysis_name')),
            params: rs.getString(rs.getColumnIndex('params')),
            resultSummary: rs.getString(rs.getColumnIndex('result_summary')),
            resultJson: rs.getString(rs.getColumnIndex('result_json')),
            plotType: rs.getString(rs.getColumnIndex('plot_type')),
            dataShape: rs.getString(rs.getColumnIndex('data_shape')),
            timestamp: rs.getLong(rs.getColumnIndex('timestamp'))
          });
        }
      } finally {
        rs.close();
      }
      return out;
    } catch (err) {
      const e = err as Error;
      Logger.error('[HistoryRepository] query failed: ' + e.message);
      return [];
    }
  }

  /** Total number of stored records. */
  public static async count(): Promise<number> {
    const store = HistoryRepository.store;
    if (!store) {
      return 0;
    }
    try {
      const predicates = new relationalStore.RdbPredicates('history');
      const rs = await store.query(predicates, ['id']);
      try {
        return rs.rowCount < 0 ? 0 : rs.rowCount;
      } finally {
        rs.close();
      }
    } catch (err) {
      const e = err as Error;
      Logger.error('[HistoryRepository] count failed: ' + e.message);
      return 0;
    }
  }

  /** Delete every record, or only those of one analysis / comma-separated list. */
  public static async clearHistory(analysisName?: string): Promise<number> {
    const store = HistoryRepository.store;
    if (!store) {
      return 0;
    }
    try {
      const predicates = new relationalStore.RdbPredicates('history');
      if (analysisName && analysisName !== 'all') {
        if (analysisName.includes(',')) {
          predicates.in('analysis_name', analysisName.split(','));
        } else {
          predicates.equalTo('analysis_name', analysisName);
        }
      }
      return await store.delete(predicates);
    } catch (err) {
      const e = err as Error;
      Logger.error('[HistoryRepository] clear failed: ' + e.message);
      return 0;
    }
  }

  /** Delete one record by primary key (swipe-to-delete on a history row). */
  public static async deleteRecord(id: number): Promise<number> {
    const store = HistoryRepository.store;
    if (!store) {
      return 0;
    }
    try {
      const predicates = new relationalStore.RdbPredicates('history');
      predicates.equalTo('id', id);
      return await store.delete(predicates);
    } catch (err) {
      const e = err as Error;
      Logger.error('[HistoryRepository] delete failed: ' + e.message);
      return 0;
    }
  }
}
