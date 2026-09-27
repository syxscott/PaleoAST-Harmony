/**
 * Floating Toolbar — replaces views/floating_toolbar.py (194 lines)
 * Quick-access toolbar for common operations.
 */
@Component
export struct FloatingToolbar {
  @State visible: boolean = true;
  @State positionX: number = 100;
  @State positionY: number = 100;
  // `isDragging` was written by the pan's start/end callbacks and read by
  // nothing, so it never affected rendering; the gesture now only needs the
  // delta, and the dead state plus the three uncalled show()/hide()/toggle()
  // methods are gone.
  //
  // NOTE for the caller: the toolbar positions ITSELF with `.position()` (see
  // build()). Applying a `.position()` to the component from outside stacks a
  // second offset on top, which is why the toolbar used to sit at 80%/80% and
  // drag from there rather than from its own coordinates.
  //
  // Known limitation: the drag is not clamped, so the toolbar can be pulled
  // out of reach. Clamping needs the window size, and the only way to get it is
  // a device-only @kit display call that cannot be exercised in the Node test
  // harness — left for a device-tested pass rather than shipping untested.

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
        // Tap reports the persisted history; long-press clears it. Keeping both
        // on one button avoids cluttering the toolbar while still making the
        // destructive action reachable.
        Button('[History]').fontSize(10).height(28)
          .onClick(() => { this.onAction('history'); })
          .gesture(LongPressGesture().onAction(() => { this.onAction('clearhistory'); }))
        Button('[Theme]').fontSize(10).height(28).onClick(() => { this.onAction('theme'); })
      }
      .padding(4).borderRadius(8)
      .backgroundColor('#FFFFFF')
      .border({ width: 1, color: '#E4E7EB' })
      .shadow({ radius: 8, color: '#00000020', offsetY: 2 })
      .position({ x: this.positionX, y: this.positionY })
      // GestureMask: PARALLEL lets the pan and the child buttons both receive
      // the touch. Without it the pan gesture competes with the button clicks,
      // so dragging the toolbar could swallow taps on [Undo] / [Export] / etc.
      .gesture(
        PanGesture()
          .gestureMask(GestureMask.PARALLEL)
          .onActionUpdate((event: GestureEvent) => {
            this.positionX += event.deltaX;
            this.positionY += event.deltaY;
          })
      )
    }
  }
}
