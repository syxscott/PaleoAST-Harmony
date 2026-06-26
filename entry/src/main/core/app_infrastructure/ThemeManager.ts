export class ThemeManager { private _dark=false; get isDark(){return this._dark;} toggle(){this._dark=!this._dark;} setDark(d:boolean){this._dark=d;} }
