/**
 * Keeping the platform's colour mode in step with the application's own
 * dark-mode switch.
 *
 * The colours of this application are resources: a `$r('app.color.NAME')`
 * reference resolves against `resources/base/element/color.json` or
 * `resources/dark/element/color.json` depending on the *colour mode* — not
 * on an application variable.
 *
 * The Ribbon has a switch of its own. Before this file existed, that switch
 * only flipped a boolean: 72 places had to spell out `darkMode ? '#a' : '#b'`
 * by hand, and the resources never followed it.
 *
 * `UIAbilityContext.setColorMode` is the official way to tell the platform
 * which set of resources to use, and the platform gives the ability's colour
 * mode priority over the system's — which is exactly what an in-app switch
 * needs.
 */
import { ConfigurationConstant, common } from '@kit.AbilityKit';

/** The AppStorage key the Ribbon writes and every component reads. */
export const DARK_MODE_KEY: string = 'darkMode';

/**
 * Switch the application between the light and the dark colour resources.
 *
 * A failure here must not take the application down: the Canvas and the SVG
 * export read the token table directly and stay correct either way, so a
 * runtime without setColorMode only loses the automatic switching of the
 * plain UI attributes.
 *
 * @param ctx the ability context of the running ability
 * @param dark true for the dark theme
 */
export function applyColorMode(ctx: common.UIAbilityContext, dark: boolean): void {
  try {
    ctx.setColorMode(
      dark
        ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
        : ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT
    );
  } catch (err) {
    const message: string = (err as Error).message;
    console.warn('setColorMode failed, the theme will not follow the switch: ' + message);
  }
}
