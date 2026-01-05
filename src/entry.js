import { AutoSkipPlugin } from './core/AutoSkipPlugin.js';

const PLUGIN_ID = 'autoskip';
if (!window[PLUGIN_ID]) {
  window[PLUGIN_ID] = true;
  new AutoSkipPlugin();
}
