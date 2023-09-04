import { moment, App, MarkdownSectionInformation, ButtonComponent, TextComponent, TFile } from "obsidian";
import { SimpleTimeTrackerSettings } from "./settings";

export interface Tracker {
    total: TotalTime;
    editEnabled: boolean;
    format: string;
    entries: Entry[];
}

export interface TotalTime {
    name: string;
    totalTime: number;
}

export interface Entry {
    name: string;
    startTime: number;
    endTime: number;
    subEntries: Entry[];
}


export async function saveTracker(tracker: Tracker, app: App, fileName: string, section: MarkdownSectionInformation): Promise<void> {
    let file = app.vault.getAbstractFileByPath(fileName) as TFile;
    if (!file)
        return;
    let content = await app.vault.read(file);

    // figure out what part of the content we have to edit
    let lines = content.split("\n");
    let prev = lines.filter((_, i) => i <= section.lineStart).join("\n");
    let next = lines.filter((_, i) => i >= section.lineEnd).join("\n");
    // edit only the code block content, leave the rest untouched
    // let totalTime: TotalTime = { name: "hello", totalTime: 1234 };
    // tracker.total = totalTime;
    content = `${prev}\n${JSON.stringify(tracker)}\n${next}`;

    await app.vault.modify(file, content);
}

export function loadTracker(json: string): Tracker {
    if (json) {
        try {
            // Forward Compatibility block
            // As new fields are added, set default values here
            let raw_record = JSON.parse(json);
            raw_record.editEnabled = raw_record.editEnabled ?? true
            raw_record.format = raw_record.format ?? "hh:mm"
            return raw_record
        } catch (e) {
            console.log(`Failed to parse Tracker from ${json}`);
        }
    }
    return {total: {name:"hello1", totalTime:0}, editEnabled:true, format: "mm", entries: [] };
}

export function displayTracker(tracker: Tracker, element: HTMLElement, file: string, getSectionInfo: () => MarkdownSectionInformation, settings: SimpleTimeTrackerSettings): void {
    let running = isRunning(tracker);
    let table = element.createEl("table", {cls: "simple-time-tracker-table"});
    let row = table.createEl("tr");

    // add start/stop & edit controls
    let entryButtonsTd = row.createEl("td");

    let chgTotalTimeBox = null as TextComponent
        // make the parts of setTotalTime
        // available to the GUI parts that need it
        // HACK - cuz I don't know how to do it right
        // Problem: how do I get the 'final' value from a TextComponent
        // IE. when focus moves away from the object
        // Workaround: pick up the value when EditEnabled=>false

    new ButtonComponent(entryButtonsTd)
        .setClass("clickable-icon")
        .setIcon(`lucide-${running ? "stop" : "play"}-circle`)
        .setTooltip(`${running ? "Stop" : "Start"}`)
        .onClick(async () => {
            if (running) {
                endRunningEntry(tracker);
            } else {
                startNewEntry(tracker, null);
            }
            await saveTracker(tracker, this.app, file, getSectionInfo());
            });

    new ButtonComponent(entryButtonsTd)
        .setClass("clickable-icon")
        .setIcon(`${isEditEnabled(tracker) ? 'lucide-check' : 'lucide-pencil' }`)
        .setTooltip("Edit Record")
        .onClick(async() => {
            if(isEditEnabled(tracker)) {
                editModeSet(tracker,false);
                // When edit mode is cleared take other actions    
                // TODO setup new Total Time 
                // need to wrangle access to the data entry field
                chgTotalTime(tracker, chgTotalTimeBox);
            } else {
                editModeSet(tracker, true)
            }
            await saveTracker(tracker, this.app, file, getSectionInfo());
        })
    
    let total = row.createEl("td", {text: String(tracker.total.totalTime)});
    row.createEl("td", {text: tracker.total.name});
          
    // Sum of timers
  
    setTotalTimeValue(tracker, total, settings);
    let intervalId = window.setInterval(() => {
        // we delete the interval timer when the element is removed
        if (!element.isConnected) {
            window.clearInterval(intervalId);
            return;
        }
        setTotalTimeValue(tracker, total, settings);
    }, 1000);
    
    if (tracker.entries.length > 0 && tracker.editEnabled) {

        chgTotalTimeBox = new TextComponent(element)
            .setPlaceholder("Set Total Time in Minutes")
            .setDisabled(running)
            ;
        chgTotalTimeBox.inputEl.addClass("simple-time-tracker-txt");


        let newSegmentNameBox = new TextComponent(element)
            .setPlaceholder("Segment name")
            .setDisabled(running);
        newSegmentNameBox.inputEl.addClass("simple-time-tracker-txt");

        // add table
        let table = element.createEl("table", {cls: "simple-time-tracker-table"});
        table.createEl("tr").append(
            createEl("th", {text: "Segment"}),
            createEl("th", {text: "Start time"}),
            createEl("th", {text: "End time"}),
            createEl("th", {text: "Duration"}),
            createEl("th"));

        for (let entry of tracker.entries)
            addEditableTableRow(tracker, entry, table, newSegmentNameBox, running, file, getSectionInfo, settings, 0);

        // add copy buttons
        let buttons = element.createEl("div", {cls: "simple-time-tracker-bottom"});
        new ButtonComponent(buttons)
            .setButtonText("Copy as table")
            .onClick(() => navigator.clipboard.writeText(createMarkdownTable(tracker, settings)));
        new ButtonComponent(buttons)
            .setButtonText("Copy as CSV")
            .onClick(() => navigator.clipboard.writeText(createCsv(tracker, settings)));
    }
}

export function isEditEnabled(tracker: Tracker) {
    return tracker.editEnabled;
}

export function editModeSet(tracker: Tracker, val: boolean) {
    tracker.editEnabled = val
    return val
}

function startSubEntry(entry: Entry, name: string) {
    // if this entry is not split yet, we add its time as a sub-entry instead
    if (!entry.subEntries) {
        entry.subEntries = [{...entry, name: `Part 1`}];
        entry.startTime = null;
        entry.endTime = null;
    }

    if (!name)
        name = `Part ${entry.subEntries.length + 1}`;
    entry.subEntries.push({name: name, startTime: moment().unix(), endTime: null, subEntries: null});
}

function startNewEntry(tracker: Tracker, name: string): void {
    if (!name)
        name = `Segment ${tracker.entries.length + 1}`;
    let entry: Entry = {name: name, startTime: moment().unix(), endTime: null, subEntries: null};
    tracker.entries.push(entry);
}

function endRunningEntry(tracker: Tracker): void {
    let entry = getRunningEntry(tracker.entries);
    entry.endTime = moment().unix();
    tracker.total.totalTime = getTotalDuration(tracker.entries)/1000
}

function chgTotalTime(tracker: Tracker, chgTotalTimeBox: TextComponent ): void {
    if( chgTotalTimeBox == null ) {
        console.log('chgTimeBox Undefined')
        return;
    }
    let desiredDurationStr = chgTotalTimeBox.getValue();
    if( 0 === desiredDurationStr.length ) {
        console.log('chgTimeBox null string')
        return;
    }
    let desiredDurationMins = Number(desiredDurationStr);
    console.log('desiredTotalTime=',desiredDurationMins)
    if( isNaN(desiredDurationMins) ) {
        console.log('chgTimeBox NaN: ${desiredDurationStr} : ',desiredDurationStr)
        return;
    }
    console.log('desiredTotalTime=',desiredDurationMins)
    // creating a new Entry and setting it's duration
    startNewEntry(tracker, 'Manual');
    let entry = getRunningEntry(tracker.entries);
    entry.startTime = moment().unix();
    entry.endTime = entry.startTime;

    // Adjust Total Time by
    // by changing StartTime of the new tracker.entry
    // Calc desired delta-T to get desired TotalTime
    let currentTotalTime = getTotalDuration(tracker.entries)/1000;
    let deltaTime = desiredDurationMins*60 - currentTotalTime;
    entry.startTime = entry.endTime - deltaTime;
    tracker.total.totalTime = getTotalDuration(tracker.entries)/1000
    console.log('adjusted Time info: oldTot=', currentTotalTime,' deltaT=', deltaTime, ' startT=',entry.startTime)
}

function removeEntry(entries: Entry[], toRemove: Entry): boolean {
    if (entries.contains(toRemove)) {
        entries.remove(toRemove);
        return true;
    } else {
        for (let entry of entries) {
            if (entry.subEntries && removeEntry(entry.subEntries, toRemove)) {
                // if we only have one sub entry remaining, we can merge back into our main entry
                if (entry.subEntries.length == 1) {
                    let single = entry.subEntries[0];
                    entry.startTime = single.startTime;
                    entry.endTime = single.endTime;
                    entry.subEntries = null;
                }
                return true;
            }
        }
    }
    return false;
}

function isRunning(tracker: Tracker): boolean {
    return !!getRunningEntry(tracker.entries);
}

function getRunningEntry(entries: Entry[]): Entry {
    for (let entry of entries) {
        // if this entry has sub entries, check if one of them is running
        if (entry.subEntries) {
            let running = getRunningEntry(entry.subEntries);
            if (running)
                return running;
        } else {
            // if this entry has no sub entries and no end time, it's running
            if (!entry.endTime)
                return entry;
        }
    }
    return null;
}

function getDuration(entry: Entry) {
    if (entry.subEntries) {
        return getTotalDuration(entry.subEntries);
    } else {
        let endTime = entry.endTime ? moment.unix(entry.endTime) : moment();
        return endTime.diff(moment.unix(entry.startTime));
    }
}

function getTotalDuration(entries: Entry[]): number {
    let ret = 0;
    for (let entry of entries)
        ret += getDuration(entry);
    return ret;
}

function setTotalTimeValue(tracker: Tracker, total: HTMLElement, settings: SimpleTimeTrackerSettings) {
    total.setText(formatDuration(getTotalDuration(tracker.entries), settings));
}

function setCountdownValues(tracker: Tracker, current: HTMLElement, total: HTMLElement, currentDiv: HTMLDivElement, settings: SimpleTimeTrackerSettings) {
    let running = getRunningEntry(tracker.entries);
    if (running && !running.endTime) {
        current.setText(formatDuration(getDuration(running), settings));
        currentDiv.hidden = false;
    } else {
        currentDiv.hidden = true;
    }
    total.setText(formatDuration(getTotalDuration(tracker.entries), settings));
}

function formatTimestamp(timestamp: number, settings: SimpleTimeTrackerSettings): string {
    return moment.unix(timestamp).format(settings.timestampFormat);
}

function formatDuration(totalTime: number, settings: SimpleTimeTrackerSettings): string {
    let ret = "";
    let duration = moment.duration(totalTime);
    return duration.asMinutes().toFixed(2) + "m";

    let hours: number;
    if (settings.fineGrainedDurations) {
        if (duration.years() > 0)
            ret += duration.years() + "y ";
        if (duration.months() > 0)
            ret += duration.months() + "M ";
        if (duration.days() > 0)
            ret += duration.days() + "d ";
        hours = duration.hours();
    } else {
        hours = Math.floor(duration.asHours());
    }
    if (hours > 0)
        ret += hours + "h ";
    if (duration.minutes() > 0)
        ret += duration.minutes() + "m ";
    ret += duration.seconds() + "s";
    return ret;
}

function createMarkdownTable(tracker: Tracker, settings: SimpleTimeTrackerSettings): string {
    let table = [["Segment", "Start time", "End time", "Duration"]];
    for (let entry of tracker.entries)
        table.push(...createTableSection(entry, settings));
    table.push(["**Total**", "", "", `**${formatDuration(getTotalDuration(tracker.entries), settings)}**`]);

    let ret = "";
    // calculate the width every column needs to look neat when monospaced
    let widths = Array.from(Array(4).keys()).map(i => Math.max(...table.map(a => a[i].length)));
    for (let r = 0; r < table.length; r++) {
        // add separators after first row
        if (r == 1)
            ret += "| " + Array.from(Array(4).keys()).map(i => "-".repeat(widths[i])).join(" | ") + " |\n";

        let row: string[] = [];
        for (let i = 0; i < 4; i++)
            row.push(table[r][i].padEnd(widths[i], " "));
        ret += "| " + row.join(" | ") + " |\n";
    }
    return ret;
}

function createCsv(tracker: Tracker, settings: SimpleTimeTrackerSettings): string {
    let ret = "";
    for (let entry of tracker.entries) {
        for (let row of createTableSection(entry, settings))
            ret += row.join(settings.csvDelimiter) + "\n";
    }
    return ret;
}

function createTableSection(entry: Entry, settings: SimpleTimeTrackerSettings): string[][] {
    let ret: string[][] = [[
        entry.name,
        entry.startTime ? formatTimestamp(entry.startTime, settings) : "",
        entry.endTime ? formatTimestamp(entry.endTime, settings) : "",
        entry.endTime || entry.subEntries ? formatDuration(getDuration(entry), settings) : ""]];
    if (entry.subEntries) {
        for (let sub of entry.subEntries)
            ret.push(...createTableSection(sub, settings));
    }
    return ret;
}

function addEditableTableRow(tracker: Tracker, entry: Entry, table: HTMLTableElement, newSegmentNameBox: TextComponent, running: boolean, file: string, getSectionInfo: () => MarkdownSectionInformation, settings: SimpleTimeTrackerSettings, indent: number) {
    let row = table.createEl("tr");

    let name = row.createEl("td");
    let namePar = name.createEl("span", {text: entry.name});
    namePar.style.marginLeft = `${indent}em`;
    let nameBox = new TextComponent(name).setValue(entry.name);
    nameBox.inputEl.hidden = true;

    row.createEl("td", {text: entry.startTime ? formatTimestamp(entry.startTime, settings) : ""});
    row.createEl("td", {text: entry.endTime ? formatTimestamp(entry.endTime, settings) : ""});
    row.createEl("td", {text: entry.endTime || entry.subEntries ? formatDuration(getDuration(entry), settings) : ""});

    let entryButtons = row.createEl("td");
    if (!running) {
        new ButtonComponent(entryButtons)
            .setClass("clickable-icon")
            .setIcon(`lucide-play`)
            .setTooltip("Continue")
            .onClick(async () => {
                startSubEntry(entry, newSegmentNameBox.getValue());
                await saveTracker(tracker, this.app, file, getSectionInfo());
            });
    }
    let editButton = new ButtonComponent(entryButtons)
        .setClass("clickable-icon")
        .setTooltip("Edit")
        .setIcon("lucide-pencil")
        .onClick(async () => {
            if (namePar.hidden) {
                namePar.hidden = false;
                nameBox.inputEl.hidden = true;
                editButton.setIcon("lucide-pencil");
                if (nameBox.getValue()) {
                    entry.name = nameBox.getValue();
                    namePar.setText(entry.name);
                    await saveTracker(tracker, this.app, file, getSectionInfo());
                }
            } else {
                namePar.hidden = true;
                nameBox.inputEl.hidden = false;
                nameBox.setValue(entry.name);
                editButton.setIcon("lucide-check");
            }
        });
    new ButtonComponent(entryButtons)
        .setClass("clickable-icon")
        .setTooltip("Remove")
        .setIcon("lucide-trash")
        .onClick(async () => {
            removeEntry(tracker.entries, entry);
            await saveTracker(tracker, this.app, file, getSectionInfo());
        });

    if (entry.subEntries) {
        for (let sub of entry.subEntries)
            addEditableTableRow(tracker, sub, table, newSegmentNameBox, running, file, getSectionInfo, settings, indent + 1);
    }
}
