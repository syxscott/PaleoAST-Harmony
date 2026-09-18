/**
 * DialogManager — tag-based dialog registry (ohos_smart_dialog pattern).
 *
 * Replaces the 34 per-dialog @State booleans: dialogs are opened/closed by
 * name through a single AppStorage-backed slot, so adding a new dialog no
 * longer requires touching Index state, DialogLayer props, AND the open
 * switch — just register a render branch in DialogLayer.
 *
 * Usage:
 *   DialogManager.open('PCA', { nComponents: 3 });  // anywhere in the app
 *   DialogManager.dismiss();                        // close current dialog
 *   DialogManager.isOpen();                         // any dialog open?
 */

export class DialogManager {
  static readonly KEY_ACTIVE = 'activeDialog';
  static readonly KEY_PARAMS = 'activeDialogParams';

  /** Open a dialog by registered name, optionally carrying parameters. */
  static open(name: string, params?: Record<string, Object>): void {
    if (params) {
      AppStorage.setOrCreate(DialogManager.KEY_PARAMS, params);
    } else {
      AppStorage.setOrCreate(DialogManager.KEY_PARAMS, {} as Record<string, Object>);
    }
    AppStorage.setOrCreate(DialogManager.KEY_ACTIVE, name);
  }

  /** Close the currently open dialog (if any). */
  static dismiss(): void {
    AppStorage.setOrCreate(DialogManager.KEY_ACTIVE, '');
  }

  /** Whether a dialog (optionally a specific one) is open. */
  static isOpen(name?: string): boolean {
    const active = AppStorage.get<string>(DialogManager.KEY_ACTIVE) ?? '';
    return name ? active === name : active.length > 0;
  }

  /** Params passed to the currently open dialog (empty by default). */
  static getParams(): Record<string, Object> {
    return AppStorage.get<Record<string, Object>>(DialogManager.KEY_PARAMS)
      ?? ({} as Record<string, Object>);
  }
}
