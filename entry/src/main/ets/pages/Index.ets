import { StateManager } from '../../core/data/index';
import { parseCSV } from '../../core/parsers/index';

/**
 * PaleoAST-Harmony Main Page
 *
 * Layout: Ribbon (top) + Navigation (left) + Workspace (center) + StatusBar (bottom)
 * Mirrors the PyQt6 MainWindow architecture.
 */

@Entry
@Component
struct Index {
  @State currentTab: number = 0;
  @State currentNavSection: string = '';
  @State hasData: boolean = false;
  @State statusText: string = 'PaleoAST-Harmony — Ready';
  @State dataInfo: string = 'No data loaded';
  @State darkMode: boolean = false;
  @State workspaceContent: number = 0; // 0=placeholder, 1=spreadsheet, 2=plot

  private stateMgr: StateManager = StateManager.getInstance();

  // Ribbon tabs
  private tabs: string[] = ['Home', 'Analysis', 'Morphometrics', 'Stratigraphy', 'Macroevolution'];

  // Navigation tree sections
  private navSections: NavItem[] = [
    { name: 'Multivariate', icon: '📊', children: ['PCA', 'PCoA', 'NMDS', 'LDA', 'CCA'] },
    { name: 'Univariate', icon: '📈', children: ['Summary', 'Normality', 't-test', 'ANOVA', 'Kruskal-Wallis'] },
    { name: 'Diversity', icon: '🌿', children: ['Diversity Indices', 'Rarefaction', 'SHE Analysis'] },
    { name: 'Clustering', icon: '🔗', children: ['Hierarchical Clustering', 'CONISS'] },
    { name: 'Tests', icon: '🧪', children: ['ANOSIM', 'PERMANOVA', 'SIMPER'] },
    { name: 'Morphometrics', icon: '🦴', children: ['GPA', 'EFA', 'Eigenshape', 'TPS Grid', 'Allometry'] },
    { name: 'Stratigraphy', icon: '🪨', children: ['Spectral', 'Markov', 'Directional', 'Wavelet', 'Extinction CI'] },
    { name: 'Phylogenetics', icon: '🌳', children: ['Fitch Parsimony', 'PIC', 'Phylo Signal'] },
    { name: 'Macroevolution', icon: '🦕', children: ['Cohort Survival', 'Diversity Dynamics', 'FBD Process'] },
  ];

  aboutToAppear(): void {
    this.hasData = this.stateMgr.hasData;
  }

  build() {
    Column() {
      // ─── Ribbon Bar ───
      this.RibbonBar()

      // ─── Main Content: Nav + Workspace ───
      Row() {
        // Navigation Tree (left sidebar)
        this.NavigationPanel()

        Divider().vertical(true).width(1).color('#E4E7EB')

        // Workspace (center)
        this.WorkspacePanel()
      }
      .width('100%')
      .layoutWeight(1)

      // ─── Status Bar ───
      this.StatusBar()
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.darkMode ? '#1a1a2e' : '#FFFFFF')
  }

  @Builder RibbonBar() {
    Row() {
      ForEach(this.tabs, (tab: string, index: number) => {
        Text(tab)
          .fontSize(13)
          .fontWeight(this.currentTab === index ? FontWeight.Bold : FontWeight.Normal)
          .fontColor(this.currentTab === index ? '#3498DB' : (this.darkMode ? '#ccc' : '#2C3E50'))
          .padding({ left: 16, right: 16, top: 8, bottom: 8 })
          .borderRadius(6)
          .backgroundColor(this.currentTab === index ? (this.darkMode ? '#2a2a4a' : '#EBF5FB') : 'transparent')
          .onClick(() => { this.currentTab = index; })
      })

      Blank()

      // Theme toggle
      Text(this.darkMode ? '☀️' : '🌙')
        .fontSize(18)
        .onClick(() => { this.darkMode = !this.darkMode; })
        .padding(8)
    }
    .width('100%')
    .height(44)
    .padding({ left: 12, right: 12 })
    .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')
    .border({ width: { bottom: 1 }, color: '#E4E7EB' })
  }

  @Builder NavigationPanel() {
    Column() {
      // Search box
      TextInput({ placeholder: 'Search analyses...' })
        .width('100%')
        .height(36)
        .margin(8)
        .borderRadius(6)
        .backgroundColor(this.darkMode ? '#2a2a4a' : '#F0F0F0')

      // Navigation items
      List({ space: 2 }) {
        ForEach(this.navSections, (section: NavItem) => {
          ListItem() {
            Column() {
              // Section header
              Row() {
                Text(section.icon).fontSize(14).margin({ right: 6 })
                Text(section.name)
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.darkMode ? '#ddd' : '#2C3E50')
              }
              .width('100%')
              .padding({ left: 12, right: 12, top: 8, bottom: 8 })
              .onClick(() => {
                this.currentNavSection = this.currentNavSection === section.name ? '' : section.name;
              })

              // Children (expandable)
              if (this.currentNavSection === section.name) {
                ForEach(section.children, (child: string) => {
                  Row() {
                    Text('  • ' + child)
                      .fontSize(12)
                      .fontColor(this.darkMode ? '#aaa' : '#7F8C8D')
                      .padding({ left: 24, top: 4, bottom: 4 })
                  }
                  .width('100%')
                  .onClick(() => {
                    this.statusText = `Running: ${child}...`;
                    this.handleAnalysis(child);
                  })
                })
              }
            }
          }
        })
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Auto)
    }
    .width(220)
    .height('100%')
    .backgroundColor(this.darkMode ? '#16213e' : '#FAFBFC')
    .border({ width: { right: 1 }, color: '#E4E7EB' })
  }

  @Builder WorkspacePanel() {
    Column() {
      if (!this.hasData) {
        // Placeholder
        Column() {
          Text('📊')
            .fontSize(64)
            .margin({ bottom: 16 })
          Text('PaleoAST-Harmony')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.darkMode ? '#fff' : '#2C3E50')
          Text('Load data to begin analysis')
            .fontSize(14)
            .fontColor(this.darkMode ? '#888' : '#7F8C8D')
            .margin({ top: 8 })

          Button('Open CSV File')
            .type(ButtonType.Capsule)
            .backgroundColor('#3498DB')
            .fontColor('#FFFFFF')
            .margin({ top: 20 })
            .onClick(() => { this.openFile(); })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        // Data loaded — show spreadsheet area
        Column() {
          // Tab bar for workspace views
          Row() {
            Text('Spreadsheet').fontSize(12).fontColor('#3498DB').padding(8)
            Text('Plot').fontSize(12).fontColor('#7F8C8D').padding(8)
          }
          .width('100%')
          .backgroundColor(this.darkMode ? '#1a1a2e' : '#F8F9FA')

          // Data display area
          Scroll() {
            Text(this.dataInfo)
              .fontSize(12)
              .fontFamily('monospace')
              .padding(16)
              .fontColor(this.darkMode ? '#ccc' : '#2C3E50')
          }
          .layoutWeight(1)
          .width('100%')
        }
        .width('100%')
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder StatusBar() {
    Row() {
      Text(this.statusText)
        .fontSize(11)
        .fontColor(this.darkMode ? '#888' : '#7F8C8D')
        .layoutWeight(1)

      Text(this.dataInfo)
        .fontSize(11)
        .fontColor(this.darkMode ? '#666' : '#BDC3C7')
    }
    .width('100%')
    .height(28)
    .padding({ left: 12, right: 12 })
    .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')
    .border({ width: { top: 1 }, color: '#E4E7EB' })
  }

  private openFile(): void {
    // In real implementation, use @ohos.file.picker
    // For now, simulate loading sample data
    const sampleCSV = 'Sample,Var1,Var2,Var3,Var4\n' +
      'A,5.1,3.5,1.4,0.2\nB,4.9,3.0,1.4,0.2\nC,4.7,3.2,1.3,0.2\n' +
      'D,4.6,3.1,1.5,0.2\nE,5.0,3.6,1.4,0.2\nF,5.4,3.9,1.7,0.4\n' +
      'G,4.6,3.4,1.4,0.3\nH,5.0,3.4,1.5,0.2\nI,4.4,2.9,1.4,0.2\n' +
      'J,4.9,3.1,1.5,0.1';

    try {
      const dm = parseCSV(sampleCSV, ',', true, true);
      this.stateMgr.setData(dm);
      this.hasData = true;
      this.dataInfo = `${dm.nSamples} samples x ${dm.nVariables} variables`;
      this.statusText = `Loaded: ${this.dataInfo}`;
    } catch (e) {
      this.statusText = `Error: ${e}`;
    }
  }

  private handleAnalysis(name: string): void {
    if (!this.hasData) {
      this.statusText = 'Please load data first';
      return;
    }
    this.statusText = `Analysis: ${name} — completed`;
  }
}

interface NavItem {
  name: string;
  icon: string;
  children: string[];
}
