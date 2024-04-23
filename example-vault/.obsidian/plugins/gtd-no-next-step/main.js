const { Plugin, PluginSettingTab, Setting } = require('obsidian')

const DEFAULT_SETTINGS = {
	nextStepTag: '#next-step',
	waitingForTag: '#waiting-for',
	projectsFolderPrefix: 'Projects/',
	projectTag: '#project',
	RequireProjectTag: true,
	projectFileCache: {
		// ['Projects/example.md']: { mtime: 123, nextStep: true, waitingFor: true }
	},
}

function* stringLineIterator(string) {
	let cursor = 0
	let newlineIndex = string.indexOf('\n')
	while (newlineIndex !== -1) {
		yield string.substring(cursor, newlineIndex)
		cursor = newlineIndex + 1
		newlineIndex = string.indexOf('\n', cursor)
	}
	if (cursor < string.length) yield string.substring(cursor)
}

const CODE_FENCE_CHARS = /^`{3,}/
function* stringLineIteratorNoCode(string) {
	let codeFenceDepth = 0
	for (let line of stringLineIterator(string)) {
		let codeFenceCharCount = line.startsWith('```') && CODE_FENCE_CHARS.exec(line)[0].length
		if (codeFenceDepth && codeFenceDepth === codeFenceCharCount) {
			codeFenceDepth = 0
		} else if (!codeFenceDepth && codeFenceCharCount) {
			codeFenceDepth = codeFenceCharCount
		} else if (!codeFenceDepth) {
			yield line
		}
	}
}

const findNextStepOrWaitingFor = (string, nextStepTagRegex, waitingForTagRegex) => {
	let hasNextStep = false
	for (let line of stringLineIteratorNoCode(string)) {
		if (line.includes('- [ ] ')) {
			if (waitingForTagRegex.test(line)) return { hasWaitingFor: true }
			if (nextStepTagRegex.test(line)) hasNextStep = true
		}
	}
	return { hasNextStep }
}

const makeTaskRegex = tagString => new RegExp(`^\\s*-\\s{1,2}\\[\\s]\\s.*${tagString}[\\W]*`, 'm')

const clearAllBadges = (fileItem) => {
	fileItem.coverEl.removeClass('gtd-no-next-step')
	fileItem.coverEl.removeClass('gtd-waiting-for')
}

const paintFileBadge = (opts, fileItem) => {
	// Is fileItem in a folder? 
	const slashes = fileItem.file.path.match(/\//g);
	const fileInFolder = slashes ? slashes.length > 1 : 0
	const folderItem = this.app.workspace.getLeavesOfType('file-explorer')[0].view.fileItems[fileItem.file.parent.path]

	const {nextStep, waitingFor} = opts || {}
	if (!nextStep && !waitingFor) {
		fileItem.coverEl.removeClass('gtd-waiting-for')
		fileItem.coverEl.addClass('gtd-no-next-step')

		if (fileInFolder) { 
			folderItem.coverEl.removeClass('gtd-waiting-for')
			folderItem.coverEl.addClass('gtd-no-next-step')
		}
	} else if (waitingFor) {
		fileItem.coverEl.removeClass('gtd-no-next-step')
		fileItem.coverEl.addClass('gtd-waiting-for')
		
		if (fileInFolder) { 
			folderItem.coverEl.removeClass('gtd-no-next-step')
			folderItem.coverEl.addClass('gtd-waiting-for')
		}
	} else {
		clearAllBadges(fileItem)
		if (fileInFolder) { 
			clearAllBadges(folderItem)
		}
	}
}

function getFileByPath(filepath) {
	const files = this.app.vault.getFiles();
	const fileFound = files.find(file => file.path === filepath)
	if(fileFound){
		return fileFound
	} else {
		return "Not a file"
	}
}

function containsTag(file, tag) {
	
	const metadata = app.metadataCache.getFileCache(file).tags?.map(a => a.tag);
	
	// Check if the file contains the tag
	let containsTagFile = false
	if (Array.isArray(metadata)){

		if( metadata.filter(tg => tg.includes(tag)).length > 0) {
			//console.log(`The tag ${tag} is present in the file`)
			containsTagFile = true
  		} else {
			//console.log(`The tag ${tag} is not present in the file`)
			containsTagFile = false
  		}
	}

	// Check if the frontmatter contains the tag
	const frontMatterTags = app.metadataCache.getCache(file.path).frontmatter?.tags;
	let containstTagFrontMatter = false

	tagWithoutHash = tag.replace('#', '');

	if (Array.isArray(frontMatterTags)) {

		if (frontMatterTags.filter(tg => tg.includes(tagWithoutHash)).length > 0) {
			//console.log(`The tag ${tagWithoutHash} is present in the front matter.`)
			containstTagFrontMatter = true
		} else {
			//console.log(`The tag ${tagWithoutHash} is not present in the front matter.`)
			containstTagFrontMatter = false
		}
	}
	
	return containstTagFrontMatter || containsTagFile
}

module.exports = class GtdNoNextStep extends Plugin {
	async onload() {
		await this.loadSettings()
		this.nextStepTagRegex = makeTaskRegex(this.settings.nextStepTag)
		this.waitingForTagRegex = makeTaskRegex(this.settings.waitingForTag)

		const handleEvent = (event, originalFilename) => {
			if (!this.isProjectFile(event.path) && (!originalFilename || !this.isProjectFile(originalFilename))) return
			this.updateFileCacheAndMaybeRepaintBadge(event, originalFilename).catch(error => {
				console.error('Error while handling event!', error)
			})
		}
		this.registerEvent(this.app.vault.on('delete', handleEvent))
		this.registerEvent(this.app.vault.on('rename', handleEvent))
		this.registerEvent(this.app.vault.on('modify', handleEvent))

		this.app.workspace.onLayoutReady(this.initialize)
		this.addSettingTab(new SettingTab(this.app, this))
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings || DEFAULT_SETTINGS)
	}

	isProjectFile = (filename) => {
		
		let hasProjectTag = false
		const file = getFileByPath(filename)

		if( file != "Not a file" ) {
			//console.log("file:"+filename)
			hasProjectTag = containsTag(file, this.settings.projectTag)
		} else {
			//console.log("Not a file:"+filename)
		}

		if( Boolean(this.settings.RequireProjectTag) ){
			return filename.startsWith(this.settings.projectsFolderPrefix)
			&& filename.endsWith('.md')
			&& !filename.includes('/_') 
			&& hasProjectTag
		} else { 
		 	return filename.startsWith(this.settings.projectsFolderPrefix)
		 	&& filename.endsWith('.md')
		 	&& !filename.includes('/_') 
		}
	}

	containsIncompleteNextStepOrWaitingFor = string => findNextStepOrWaitingFor(string, this.nextStepTagRegex, this.waitingForTagRegex)

	scheduleRepaintBadge = (path, clearAll) => {
		window.setTimeout(() => {
			const leaves = this.app.workspace.getLeavesOfType('file-explorer')
			if (leaves?.[0]?.view?.fileItems?.[path]) {
				if (clearAll) clearAllBadges(leaves[0].view.fileItems[path])
				else paintFileBadge(this.settings.projectFileCache[path], leaves[0].view.fileItems[path])
			}
		})
	}

	updateFileCacheAndMaybeRepaintBadge = async ({path, stat, deleted}, originalFilename) => {
		if (deleted || !this.isProjectFile(path)) {
			delete this.settings.projectFileCache[path]
			delete this.settings.projectFileCache[originalFilename]
			await this.saveSettings()
			return this.scheduleRepaintBadge(path, true)
		}
		if (!deleted) {
			const string = await this.app.vault.cachedRead(
				this.app.vault.getAbstractFileByPath(path)
			)
			const {nextStep, waitingFor} = this.settings.projectFileCache[path] || {}
			this.settings.projectFileCache[path] = this.settings.projectFileCache[path] || {}
			this.settings.projectFileCache[path].mtime = stat.mtime
			const { hasNextStep, hasWaitingFor } = this.containsIncompleteNextStepOrWaitingFor(string)
			this.settings.projectFileCache[path].nextStep = hasNextStep
			this.settings.projectFileCache[path].waitingFor = hasWaitingFor
			await this.saveSettings()
			if (
				this.settings.projectFileCache[path].waitingFor !== waitingFor
				|| this.settings.projectFileCache[path].nextStep !== nextStep
			) this.scheduleRepaintBadge(path)
		}
	}

	refreshAllFileBadges = async () => {
		const projectFilesList = this
			.app
			.vault
			.getMarkdownFiles()
			.filter(f => this.isProjectFile(f.path))
		const filesMap = {}
		let needToSave = false
		for (const tFile of projectFilesList) {
			filesMap[tFile.path] = this.settings.projectFileCache[tFile.path] || {
				mtime: tFile.stat.mtime,
			}
			const lastCache = this.settings.projectFileCache[tFile.path]
			if (tFile.stat.mtime > (lastCache ? lastCache.mtime : 0)) {
				needToSave = true
				const string = await this.app.vault.cachedRead(tFile)
				const { hasNextStep, hasWaitingFor } = this.containsIncompleteNextStepOrWaitingFor(string)
				filesMap[tFile.path].nextStep = hasNextStep
				filesMap[tFile.path].waitingFor = hasWaitingFor
			}
		}
		for (const path in this.settings.projectFileCache) if (!filesMap[path]) needToSave = true
		if (needToSave) {
			this.settings.projectFileCache = filesMap
			await this.saveSettings()
		}
		const leaves = this.app.workspace.getLeavesOfType('file-explorer')
		if (leaves?.length) {
			const fileItems = leaves[0].view?.fileItems || {}
			for (const f in fileItems) if (this.isProjectFile(f)) {
				paintFileBadge(filesMap[f], fileItems[f])
			}
		}
	}

	initialize = () => {
		this.refreshAllFileBadges().catch(error => {
			console.error('Unexpected error in "gtd-no-next-step" plugin initialization.', error)
		})
	}
}

class SettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display() {
		const {containerEl} = this
		containerEl.empty()
		new Setting(containerEl)
			.setName('Projects folder')
			.setDesc('The folder where project files live, e.g. "Projects/".')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.projectsFolderPrefix)
					.setValue(this.plugin.settings.projectsFolderPrefix)
					.onChange(async (value) => {
						this.plugin.settings.projectsFolderPrefix = value
						await this.plugin.saveSettings()
					})
			)
		new Setting(containerEl)
			.setName('Next-Step tag')
			.setDesc('The tag that indicates a task has a next step.')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.nextStepTag)
					.setValue(this.plugin.settings.nextStepTag)
					.onChange(async (value) => {
						this.plugin.settings.nextStepTag = value
						await this.plugin.saveSettings()
					})
			)
		new Setting(containerEl)
			.setName('Waiting-For tag')
			.setDesc('The tag that indicates a task is waiting for an external action.')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.waitingForTag)
					.setValue(this.plugin.settings.waitingForTag)
					.onChange(async (value) => {
						this.plugin.settings.waitingForTag = value
						await this.plugin.saveSettings()
					})
			)
		
		new Setting(containerEl)
			.setName('Require Project Tag?')
			.setDesc('With this setting enabled, badges will only appear on files (and their containing folder) with the project tag.')
			.addToggle(toggle => toggle
						.setValue(this.plugin.settings.RequireProjectTag)
						.onChange(async (value) => {
							this.plugin.settings.RequireProjectTag = value; 
							await this.plugin.saveSettings();
						})
			)
		new Setting(containerEl)
			.setName('Project tag')
			.setDesc('The tag that indicates a file is a project file (handy in case you  store project related files in a project folder).')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.projectTag)
					.setValue(this.plugin.settings.projectTag)
					.onChange(async (value) => {
						this.plugin.settings.projectTag = value
						await this.plugin.saveSettings()
					})
			)
	}
}
