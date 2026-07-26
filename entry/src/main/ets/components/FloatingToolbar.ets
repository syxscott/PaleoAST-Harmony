/**
 * Floating Toolbar — replaces views/floating_toolbar.py (194 lines)
 * Quick-access toolbar for common operations.
 */
@Component
export struct FloatingToolbar {
  @State visible: boolean = true;
  @State positionX: number = 100;
  @State positionY: number = 100;
  @State isDragging: boolean = false;

  onAction: (action: string) => void = () => {};

  build() {
    if (this.visible) {
      Row() {
        Button('[Undo]').fontSize(10).height(28).onClick(() => { this.onAction('undo'); })
        Button('[Redo]').fontSize(10).height(28).onClick(() => { this.onAction('redo'); })
        Divider().vertical(true).height(20)
        Button('[PCA]').fontSize(10).height(28).onClick(() => { this.onAction('pca'); })
        Button('[NMDS]').fontSize(10).height(28).onClick(() => { this.onAction('nmds'); })
        Button('[Diversity]').fontSize(10).height(28).onClick(() => { this.onAction('diversity'); })
        Divider().vertical(true).height(20)
        Button('[Export]').fontSize(10).height(28).onClick(() => { this.onAction('export'); })
        Button('[Theme]').fontSize(10).height(28).onClick(() => { this.onAction('theme'); })
      }
      .padding(4).borderRadius(8)
      .backgroundColor('#FFFFFF')
      .border({ width: 1, color: '#E4E7EB' })
      .shadow({ radius: 8, color: '#00000020', offsetY: 2 })
      .position({ x: this.positionX, y: this.positionY })
      .gesture(
        PanGesture()
          .onActionStart(() => {
            this.isDragging = true;
          })
          .onActionUpdate((event: GestureEvent) => {
            this.positionX += event.deltaX;
            this.positionY += event.deltaY;
          })
          .onActionEnd(() => {
            this.isDragging = false;
          })
      )
    }
  }

  show(): void { this.visible = true; }
  hide(): void { this.visible = false; }
  toggle(): void { this.visible = !this.visible; }
}
