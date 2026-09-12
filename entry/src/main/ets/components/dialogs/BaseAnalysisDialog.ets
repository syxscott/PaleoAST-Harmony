/**
 * BaseAnalysisDialog - Reference template for analysis configuration dialogs.
 * Provides common UI structure, validation framework, and lifecycle management.
 *
 * Note: ArkTS structs cannot use inheritance or generics, so concrete dialogs
 * (PCADialog, PCoADialog, ...) copy this structure instead of extending it.
 * Kept as a plain V1 @Component: @Param/@Event/@Local/@ObservedV2 were removed
 * because they are not valid inside a V1 struct; callbacks are ordinary
 * function properties that can be overridden via constructor params.
 */
@Component
export struct BaseAnalysisDialog {
  @Link visible: boolean;
  @State title: string = '';
  @State description: string = '';
  @State params: Record<string, Object> = {};
  @State validationError: string = '';
  @State showTips: boolean = false;
  validationRules: Array<(params: Record<string, Object>) => string | null> = [];
  onConfirm: (params: Record<string, Object>) => void = () => {};
  onCancel: () => void = () => {};

  /**
   * Override in subclasses to provide custom content builder
   */
  @Builder
  contentBuilder() {
    // Subclasses override this to provide dialog-specific content
  }

  /**
   * Validate before running; returns the first error message or null.
   */
  validate(): string | null {
    for (const rule of this.validationRules) {
      const err = rule(this.params);
      if (err) {
        return err;
      }
    }
    return null;
  }

  /**
   * Builds the dialog content column
   */
  @Builder
  buildContent() {
    Column() {
      Text(this.title).fontSize(20).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      if (this.description) {
        Text(this.description).fontSize(12).fontColor('#7F8C8D').margin({ bottom: 16 })
      }

      // Subclass content
      this.contentBuilder()

      if (this.validationError) {
        Text(this.validationError).fontSize(12).fontColor('#E74C3C').margin({ top: 8 })
      }

      Divider().margin({ top: 16, bottom: 12 })

      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF')
          .onClick(() => {
            this.visible = false;
            this.onCancel();
          }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF')
          .enabled(this.validationError === '')
          .onClick(() => {
            this.visible = false;
            this.onConfirm(this.params);
          })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 480 }).borderRadius(12)
  }

  build() {
    Column() {
      this.buildContent()
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor('rgba(0, 0, 0, 0.4)')
  }
}
