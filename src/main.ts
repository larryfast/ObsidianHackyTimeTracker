import { Plugin } from "obsidian";
import { defaultSettings, SimpleTimeTrackerSettings } from "./settings";
import { SimpleTimeTrackerSettingsTab } from "./settings-tab";
import { displayTracker, loadTracker, Tracker } from "./tracker";

export default class SimpleTimeTrackerPlugin extends Plugin {

    settings: SimpleTimeTrackerSettings;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.addSettingTab(new SimpleTimeTrackerSettingsTab(this.app, this));

        this.registerMarkdownCodeBlockProcessor("my-time-tracker", (s, e, i) => {
            let tracker: Tracker = loadTracker(s);
            e.empty();
            displayTracker(tracker, e, i.sourcePath, () => i.getSectionInfo(e), this.settings);
        });

        this.addCommand({
            id: `insert`,
            name: `Insert Time Tracker`,
            editorCallback: (e, _) => {
                e.replaceSelection("```my-time-tracker\n```\n");
            }
        });
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, defaultSettings, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}
