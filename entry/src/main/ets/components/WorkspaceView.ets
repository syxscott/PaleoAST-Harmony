/**
 * WorkspaceView — Main workspace with spreadsheet and plots
 * Replaces inline @Builder WorkspaceView in Index.ets
 */
import { StateManager, DataMatrix } from '../../core/models/index';
import { Spreadsheet } from './Spreadsheet';
import { PlotCanvas } from './PlotCanvas';
import { EventBus } from '../../core/utils/EventBus';

@Component
export struct WorkspaceView {
  @Link currentWidget: number;
  @Link workspaceWidgets: string[];
  @Link plotDataX: number[];
  @Link plotDataY: number[];
  @Link plotTitle: string;
  @Link plotType: string;
  @Link darkMode: boolean;

  // @State（非普通字段）：重新加载文件时经 EventBus 刷新，@ObjectLink 需要
  // 拿到新的 @Observed DataMatrix 实例才能更新表格
  @State dataMatrix: DataMatrix | null = null;
  // 数据被外部改变（撤销/重做/重新加载）时的刷新订阅
  private dataChangedHandler = (): void => { this.onExternalDataChanged(); };

  aboutToAppear(): void {
    this.refreshFromState();
    EventBus.getInstance().on('data_changed', this.dataChangedHandler);
  }

  aboutToDisappear(): void {
    EventBus.getInstance().off('data_changed', this.dataChangedHandler);
  }

  /** 从 AppStorage 里的 StateManager 单例同步最新 DataMatrix。 */
  private refreshFromState(): void {
    const stateMgr = AppStorage.get<StateManager>('stateMgr');
    if (stateMgr) {
      this.dataMatrix = stateMgr.dataMatrix;
    }
  }

  private onExternalDataChanged(): void {
    this.refreshFromState();
  }

  build() {
    Column() {
      Tabs({ index: this.currentWidget }) {
        ForEach(this.workspaceWidgets, (widget: string, idx: number) => {
          TabContent() {
            if (widget === 'spreadsheet') {
              if (this.dataMatrix) {
                Column() {
                  Spreadsheet({ dataMatrix: this.dataMatrix!, darkMode: this.darkMode })
                    .width('100%')
                    .height('100%');
                }
                .width('100%')
                .height('100%');
              }
            } else if (idx === this.currentWidget) {
              // Active analysis tab: always render the canvas. plotDataX/Y hold
              // THIS tab's snapshot (hydrated by Index.onWidgetChanged), and
              // PlotCanvas clears itself when the analysis has no series — so a
              // tab can never display another analysis's chart.
              Column() {
                Text(this.plotTitle)
                  .fontSize(14)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.darkMode ? '#ccc' : '#2C3E50')
                  .margin(10);
                PlotCanvas({
                  plotType: this.plotType,
                  title: this.plotTitle,
                  darkMode: this.darkMode,
                  dataX: this.plotDataX,
                  dataY: this.plotDataY
                })
                  .width('100%')
                  .layoutWeight(1);
              }
              .width('100%')
              .height('100%');
            } else {
              Text('Result: ' + widget)
                .fontSize(12)
                .padding(16)
                .fontColor(this.darkMode ? '#ccc' : '#2C3E50');
            }
          }
          .tabBar(widget);
        });
      }
      .barMode(BarMode.Scrollable)
      .barWidth('100%')
      .barHeight(32)
      .onChange((index: number) => { this.currentWidget = index; })
      .layoutWeight(1);
    }
    .width('100%')
    .height('100%');
  }
}
