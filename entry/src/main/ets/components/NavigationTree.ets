/**
 * Navigation Tree — replaces views/ui_navigation.py
 * Left sidebar with collapsible analysis categories.
 */
@Component
export struct NavigationTree {
  @State expandedSections: Set<string> = new Set();
  @State searchText: string = '';
  @State selectedEntry: string = '';

  onNavigate: (name: string) => void = () => {};

  private sections: NavSection[] = [
    { name: 'Multivariate', icon: '[M]', entries: ['PCA', 'PCoA', 'NMDS', 'LDA', 'CCA'] },
    { name: 'Univariate', icon: '[U]', entries: ['Summary', 'Normality', 't-test', 'ANOVA', 'Kruskal-Wallis'] },
    { name: 'Diversity', icon: '[D]', entries: ['Diversity Indices', 'Rarefaction', 'SHE Analysis'] },
    { name: 'Clustering', icon: '[C]', entries: ['Hierarchical Clustering', 'CONISS'] },
    { name: 'Tests', icon: '[T]', entries: ['ANOSIM', 'PERMANOVA', 'SIMPER'] },
    { name: 'Morphometrics', icon: '[Mo]', entries: ['GPA', 'EFA', 'Eigenshape', 'TPS Grid', 'Allometry', 'Evolution Rate'] },
    { name: 'Stratigraphy', icon: '[S]', entries: ['Spectral', 'Markov', 'Directional', 'Wavelet', 'Extinction CI', 'Isotope', 'Stratigraphic Correlation', 'Biostratigraphy', 'Paleo-Environment'] },
    { name: 'Phylogenetics', icon: '[Ph]', entries: ['Fitch Parsimony', 'PIC', 'Phylo Signal', 'Phylo ANOVA'] },
    { name: 'Macroevolution', icon: '[Ma]', entries: ['Cohort Survival', 'Diversity Dynamics', 'FBD Process', 'Beta Diversity', 'Null Models'] },
  ];

  build() {
    Column() {
      // Search
      TextInput({ placeholder: 'Search analyses...' })
        .width('100%').height(32).margin(8).fontSize(12).borderRadius(6)
        .onChange((v: string) => { this.searchText = v; })

      // Sections
      List({ space: 2 }) {
        ForEach(this.getFilteredSections(), (section: NavSection) => {
          ListItem() {
            Column() {
              // Section header
              Row() {
                Text(section.icon).fontSize(11).width(24).textAlign(TextAlign.Center)
                Text(section.name).fontSize(12).fontWeight(FontWeight.Medium)
                  .layoutWeight(1)
                Text(this.expandedSections.has(section.name) ? '[-]' : '[+]').fontSize(10).fontColor('#7F8C8D')
              }
              .width('100%').height(32).padding({ left: 8, right: 8 })
              .onClick(() => { this.toggleSection(section.name); })

              // Entries (when expanded)
              if (this.expandedSections.has(section.name)) {
                ForEach(section.entries, (entry: string) => {
                  Row() {
                    Text('    ' + entry).fontSize(11)
                      .fontColor(this.selectedEntry === entry ? '#3498DB' : '#7F8C8D')
                      .fontWeight(this.selectedEntry === entry ? FontWeight.Medium : FontWeight.Normal)
                  }
                  .width('100%').height(26).padding({ left: 32 })
                  .backgroundColor(this.selectedEntry === entry ? '#EBF5FB' : 'transparent')
                  .onClick(() => {
                    this.selectedEntry = entry;
                    this.onNavigate(entry);
                  })
                })
              }
            }
          }
        })
      }
      .width('100%').layoutWeight(1).scrollBar(BarState.Auto)

      // Bottom info
      Text('PaleoAST v1.0').fontSize(9).fontColor('#BDC3C7')
        .padding(8).textAlign(TextAlign.Center).width('100%')
    }
    .width('100%').height('100%')
  }

  private toggleSection(name: string): void {
    if (this.expandedSections.has(name)) {
      this.expandedSections.delete(name);
    } else {
      this.expandedSections.add(name);
    }
  }

  private getFilteredSections(): NavSection[] {
    if (!this.searchText) return this.sections;
    const ft = this.searchText.toLowerCase();
    return this.sections
      .map(s => ({
        ...s,
        entries: s.entries.filter(e => e.toLowerCase().includes(ft)),
      }))
      .filter(s => s.entries.length > 0 || s.name.toLowerCase().includes(ft));
  }
}

interface NavSection {
  name: string;
  icon: string;
  entries: string[];
}
