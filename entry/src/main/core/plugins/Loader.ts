import {Plugin} from "./Base"; import {PluginRegistry} from "./Registry"; export function loadPlugin(p:Plugin){PluginRegistry.register(p);}
