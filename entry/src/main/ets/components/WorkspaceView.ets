/**
 * WorkspaceView — Main workspace with spreadsheet and plots
 * Replaces inline @Builder WorkspaceView in Index.ets
 */
import { StateManager, DataMatrix } from '../../core/models/index';
import { Spreadsheet } from './Spreadsheet';
import { PlotCanvas } from './PlotCanvas';

@Component
export struct WorkspaceView {
  @Link currentWidget: number;
  @Link workspaceWidgets: string[];
  @Link plotDataX: number[];
  @Link plotDataY: number[];
  @Link plotTitle: string;
  @Link plotType: string;
  @Link darkMode: boolean;

  // StateManager singleton is read from AppStorage (set by Index.aboutToAppear).
  // @ObjectLink was removed: it requires a parent-passed @Observed instance which
  // Index never provided (compile error), and the unused StateManagerWrapper class
  // was deleted.
  private dataMatrix: DataMatrix | null = null;
  private plotRef: PlotCanvas | null = null;

  aboutToAppear(): void {
    const stateMgr = AppStorage.get<StateManager>('stateMgr');
    if (stateMgr) {
      this.dataMatrix = stateMgr.dataMatrix;
    }
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
            } else if (widget === 'spreadsheet+plot' || (this.plotDataX.length > 0 && idx === this.currentWidget)) {
              // Live chart widget: real Canvas rendering via PlotCanvas
              Column() {
                Text(this.plotTitle)
                  .fontSize(14)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.darkMode ? '#ccc' : '#2C3E50')
                  .margin(10);
                PlotCanvas({
                  plotType: this.plotType,
                  title: this.plotTitle,
                  darkMode: this.darkMode
                })
                  .width('100%')
                  .layoutWeight(1)
                  .onAreaChange((_old: Area, _new: Area) => {
                    // Data can be re-pushed through the imperative API by Index
                  });
              }
              .width('100%')
              .height('100%');
            } else if (this.plotDataX.length > 0) {
              Column() {
                Text(this.plotTitle)
                  .fontSize(14)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.darkMode ? '#ccc' : '#2C3E50')
                  .margin(10);
                Text('Plot: ' + widget + ' (' + this.plotDataX.length + ' points)')
                  .fontSize(12)
                  .fontColor('#7F8C8D');
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
