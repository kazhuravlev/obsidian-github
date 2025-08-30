import {App, Notice, Plugin, PluginSettingTab, requestUrl, RequestUrlParam, Setting, TFile} from 'obsidian';
import {DirSuggest, FileSuggest} from 'suggest';
import * as Handlebars from "handlebars";

interface GitHubPluginSettings {
	apiToken: string;
	username: string;
	targetDirectory: string;
	lastFetchDate: string;
	syncEnabled: boolean;
	syncPullRequests: boolean;
	lastPRFetchDate: string;
	prDirectory: string;
	useDefaultTemplateStar: boolean;
	templatePathStar: string;
	useDefaultTemplatePR: boolean;
	templatePathPR: string;
}

const DEFAULT_SETTINGS: GitHubPluginSettings = {
	apiToken: '',
	username: '',
	targetDirectory: '',
	lastFetchDate: '',
	syncEnabled: true,
	syncPullRequests: true,
	lastPRFetchDate: '',
	prDirectory: '',
	useDefaultTemplateStar: true,
	templatePathStar: '',
	useDefaultTemplatePR: true,
	templatePathPR: '',
}

interface StarredRepo {
	name: string;
	full_name: string;
	html_url: string;
	description: string;
	created_at: string;
	updated_at: string;
	language: string;
	stargazers_count: number;
	topics: string[];
	owner: {
		login: string;
		avatar_url: string;
	};
}

interface PullRequest {
	id: number;
	number: number;
	title: string;
	html_url: string;
	state: string;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	merged_at: string | null;
	draft: boolean;
	pull_request?: {
		url: string;
		html_url: string;
		merged_at: string | null;
	};
	repository_url: string;
	labels: Array<{
		name: string;
	}>;
}

export default class GitHubPlugin extends Plugin {
	settings: GitHubPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'github-fetch-stars',
			name: 'Fetch stars',
			callback: async () => {
				await this.fetchStars();
			}
		});

		this.addCommand({
			id: 'github-fetch-stars-force',
			name: 'Fetch stars (force)',
			callback: async () => {
				this.settings.lastFetchDate = ""
				await this.saveSettings()
				await this.fetchStars();
			}
		});

		this.addCommand({
			id: 'github-fetch-prs',
			name: 'Fetch pull requests',
			callback: async () => {
				await this.fetchPullRequests();
			}
		});

		this.addCommand({
			id: 'github-fetch-prs-force',
			name: 'Fetch pull requests (force)',
			callback: async () => {
				this.settings.lastPRFetchDate = ""
				await this.saveSettings()
				await this.fetchPullRequests();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GitHubSettingTab(this.app, this));

		// Always check for new data asynchronously without blocking
		if (this.settings.syncEnabled && this.settingsAreValid()) {
			// Use setTimeout to ensure the plugin loads immediately
			setTimeout(async () => {
				try {
					await this.fetchStars();
					if (this.settings.syncPullRequests) {
						await this.fetchPullRequests();
					}
				} catch (error) {
					console.error('Background sync failed:', error);
				}
			}, 100);
		}
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	settingsAreValid(): boolean {
		return Boolean(
			this.settings.username &&
			this.settings.targetDirectory
		);
	}

	async fetchStars() {
		if (!this.settings.syncEnabled) {
			new Notice('Sync is disabled. Enable it in settings to fetch stars.');
			return;
		}

		if (!this.settingsAreValid()) {
			new Notice('Please set both GitHub username and target directory in settings.');
			return;
		}

		try {
			// Ensure target directory exists
			await this.ensureTargetDirectoryExists();

			// Fetch starred repositories
			let reposCount = 0;
			let page = 1;
			let continueFetch = true;
			const firstFetch = this.settings.lastFetchDate == "";
			while (firstFetch || continueFetch) {
				const response = await this.getStarredRepos(page);

				for (const repo of response.stars) {
					const created = await this.createNoteForRepo(repo);
					if (!firstFetch && !created) {
						continueFetch = false;
						break;
					}

					reposCount++;
				}

				if (reposCount !== 0) {
					new Notice(`Fetched ${reposCount} GitHub stars`);
				}

				// Check if we have more pages to fetch
				if (!response.hasMore) {
					break;
				}

				page++;
			}

			// Update last fetch date
			this.settings.lastFetchDate = new Date().toISOString();
			await this.saveSettings();

			if (reposCount !== 0) {
				new Notice(`Total ${reposCount} GitHub stars`);
			}
		} catch (error) {
			console.error('Error fetching GitHub stars:', error);
			new Notice(`Error fetching GitHub stars: ${error.message}`);
		}
	}

	async ensureTargetDirectoryExists() {
		const {vault} = this.app;
		const dirs = this.settings.targetDirectory.split('/').filter(p => p.trim());

		let currentPath = '';
		for (const dir of dirs) {
			currentPath = currentPath ? `${currentPath}/${dir}` : dir;
			if (!(await vault.adapter.exists(currentPath))) {
				await vault.createFolder(currentPath);
			}
		}
	}

	async ensurePRDirectoryExists() {
		const {vault} = this.app;
		const prDir = this.settings.prDirectory || this.settings.targetDirectory;
		const dirs = prDir.split('/').filter(p => p.trim());

		let currentPath = '';
		for (const dir of dirs) {
			currentPath = currentPath ? `${currentPath}/${dir}` : dir;
			if (!(await vault.adapter.exists(currentPath))) {
				await vault.createFolder(currentPath);
			}
		}
	}

	async ensureDirectoryExists(dirPath: string) {
		const {vault} = this.app;
		const dirs = dirPath.split('/').filter(p => p.trim());

		let currentPath = '';
		for (const dir of dirs) {
			currentPath = currentPath ? `${currentPath}/${dir}` : dir;
			if (!(await vault.adapter.exists(currentPath))) {
				await vault.createFolder(currentPath);
			}
		}
	}

	async getStarredRepos(page: number): Promise<{ stars: StarredRepo[], hasMore: boolean }> {
		const {apiToken, username} = this.settings;
		const perPage = 100;

		const params: RequestUrlParam = {
			url: `https://api.github.com/users/${username}/starred?per_page=${perPage}&page=${page}&sort=created&direction=desc`,
			method: 'GET',
			headers: {
				'Accept': 'application/vnd.github.v3+json,application/vnd.github.mercy-preview+json',
				'User-Agent': 'GitHub-Plugin'
			}
		};

		if (apiToken) {
			params.headers = {
				...params.headers,
				'Authorization': `token ${apiToken}`
			};
		}

		const response = await requestUrl(params);
		const stars = response.json as StarredRepo[];

		return {stars: stars, hasMore: stars.length == perPage}
	}

	async createNoteForRepo(repo: StarredRepo): Promise<boolean> {
		const {vault} = this.app;
		const fileName = `${this.settings.targetDirectory}/${repo.full_name.replace('/', '-')}.md`;

		// Format dates for Obsidian
		const createdDate = new Date(repo.created_at);
		const createdFormatted = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}-${String(createdDate.getDate()).padStart(2, '0')}`;
		const currentDate = new Date();
		const modifiedFormatted = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

		const exists = await vault.adapter.exists(fileName);
		try {
			let file: TFile;

			if (exists) {
				// Get existing file
				const existingFile = this.app.vault.getAbstractFileByPath(fileName);

				if (existingFile && existingFile instanceof TFile) {
					file = existingFile;
				} else {
					// This shouldn't happen, but just in case
					throw new Error(`File exists but couldn't be accessed: ${fileName}`);
				}
			} else {
				const defaultTemplate = `# {{ name }}\n\n`;
				const fileContent = await this.renderTemplate(
					this.settings.useDefaultTemplateStar,
					this.settings.templatePathStar,
					defaultTemplate,
					repo);

				// Create new file with template or default content
				file = await vault.create(fileName, fileContent);
			}

			// Use this api only as part of default template
			if (this.settings.useDefaultTemplateStar) {
				// Build tags list starting with default github tag
				const tagsList = ['type/github-star'];

				// Add language as a tag if present
				if (repo.language) {
					tagsList.push(`github/language/${normalizeTag(repo.language)}`)
				}

				// Add repository topics if they exist
				for (const topic of repo.topics || []) {
					tagsList.push(`github/topic/${normalizeTag(topic)}`)
				}

				// Use the same API for both new and existing files
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					frontmatter['tags'] = tagsList;
					frontmatter['aliases'] = [repo.name];
					frontmatter['description'] = (repo.description || 'No description').replace(/"/g, '\\"');
					frontmatter['url'] = repo.html_url;
					frontmatter['owner'] = `https://github.com/${repo.owner.login}`;
					frontmatter['language'] = repo.language || 'Not specified';
					frontmatter['stars'] = repo.stargazers_count;
					frontmatter['created'] = createdFormatted;
					frontmatter['modified'] = modifiedFormatted;
					frontmatter['lastUpdated'] = new Date().toLocaleString();
				});
			}
		} catch (error) {
			console.error(`Error creating note for ${repo.name}:`, error);
		}

		return !exists;
	}

	private async readTemplate(forceDefault: boolean, templatePath: string, defaultTemplate: string): Promise<string> {
		if (forceDefault) {
			return defaultTemplate;
		}

		if (!templatePath) {
			new Notice(`Template path not set. Use default template.`);
			return defaultTemplate;
		}

		const exists = await this.app.vault.adapter.exists(templatePath);
		if (!exists) {
			new Notice(`Template not found: ${templatePath}. Using default.`);
			return defaultTemplate;
		}

		return await this.app.vault.adapter.read(templatePath);
	}

	private async renderTemplate<T>(forceDefault: boolean, templatePath: string, defaultTemplate: string, obj: T): Promise<string> {
		const templateContent = await this.readTemplate(forceDefault, templatePath, defaultTemplate);
		const template = Handlebars.compile<T>(templateContent);

		return template(obj);
	}

	async fetchPullRequests() {
		if (!this.settings.syncEnabled) {
			new Notice('Sync is disabled. Enable it in settings to fetch pull requests.');
			return;
		}

		if (!this.settingsAreValid()) {
			new Notice('Please set both GitHub username and target directory in settings.');
			return;
		}

		try {
			// Ensure PR directory exists
			await this.ensurePRDirectoryExists();

			// Fetch pull requests
			let prsCount = 0;
			let page = 1;
			let continueFetch = true;
			const firstFetch = this.settings.lastPRFetchDate == "";

			while (firstFetch || continueFetch) {
				const response = await this.getPullRequests(page);

				for (const pr of response.prs) {
					const created = await this.createNoteForPR(pr);
					if (!firstFetch && !created) {
						continueFetch = false;
						break;
					}

					prsCount++;
				}

				if (prsCount !== 0) {
					new Notice(`Fetched ${prsCount} pull requests`);
				}

				// Check if we have more pages to fetch
				if (!response.hasMore) {
					break;
				}

				page++;
			}

			// Update last fetch date
			this.settings.lastPRFetchDate = new Date().toISOString();
			await this.saveSettings();

			if (prsCount !== 0) {
				new Notice(`Total ${prsCount} pull requests`);
			}
		} catch (error) {
			console.error('Error fetching pull requests:', error);
			new Notice(`Error fetching pull requests: ${error.message}`);
		}
	}

	async getPullRequests(page: number): Promise<{ prs: PullRequest[], hasMore: boolean }> {
		const {apiToken, username} = this.settings;
		const perPage = 100;

		const params: RequestUrlParam = {
			url: `https://api.github.com/search/issues?q=author:${username}+type:pr&per_page=${perPage}&page=${page}&sort=created&order=desc`,
			method: 'GET',
			headers: {
				'Accept': 'application/vnd.github.v3+json',
				'User-Agent': 'GitHub-Plugin'
			}
		};

		if (apiToken) {
			params.headers = {
				...params.headers,
				'Authorization': `token ${apiToken}`
			};
		}

		const response = await requestUrl(params);
		const data = response.json as { items: PullRequest[], total_count: number };

		return {prs: data.items, hasMore: data.items.length == perPage}
	}

	async createNoteForPR(pr: PullRequest): Promise<boolean> {
		const {vault} = this.app;

		// Extract repository info from repository_url
		// Format: https://api.github.com/repos/{owner}/{repo}
		const repoUrlParts = pr.repository_url.split('/');
		const repoOwner = repoUrlParts[repoUrlParts.length - 2];
		const repoName = repoUrlParts[repoUrlParts.length - 1];
		const repoFullName = `${repoOwner}/${repoName}`;

		// Create a safe filename from PR title
		const safePrTitle = pr.title
			.replace(/[\\/:*?"<>|]/g, '-') // Replace invalid filename characters
			.replace(/\s+/g, '_') // Replace spaces with underscores
			.substring(0, 50); // Limit length to avoid too long filenames

		const prDir = this.settings.prDirectory || this.settings.targetDirectory;
		const repoDir = `${prDir}/${repoOwner}/${repoName}`;
		const fileName = `${repoDir}/${pr.number}_${safePrTitle}.md`;

		// Ensure repository directory exists
		await this.ensureDirectoryExists(repoDir);

		const exists = await vault.adapter.exists(fileName);
		try {
			let file: TFile;

			if (exists) {
				// Get existing file
				const existingFile = this.app.vault.getAbstractFileByPath(fileName);

				if (existingFile && existingFile instanceof TFile) {
					file = existingFile;
				} else {
					throw new Error(`File exists but couldn't be accessed: ${fileName}`);
				}
			} else {
				const defaultTemplate = `# {{ title }}\n\n`;
				const fileContent = await this.renderTemplate(
					this.settings.useDefaultTemplatePR,
					this.settings.templatePathPR,
					defaultTemplate,
					pr);

				// Create new file with template or default content
				file = await vault.create(fileName, fileContent);
			}

			if (this.settings.useDefaultTemplatePR) {
				// Build tags list
				const tagsList = ['type/github-pr'];

				// Add state tag
				tagsList.push(`github/pr-state/${pr.state}`);

				// Add draft tag if applicable
				if (pr.draft) {
					tagsList.push('github/pr-draft');
				}

				// Add merged tag if applicable
				if (pr.pull_request?.merged_at || pr.merged_at) {
					tagsList.push('github/pr-merged');
				}

				// Add labels as tags
				for (const label of pr.labels || []) {
					tagsList.push(`github/pr-label/${label.name.toLowerCase().replace(/\s+/g, '-')}`);
				}

				// Use the same API for both new and existing files
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					frontmatter['tags'] = tagsList;
					frontmatter['title'] = pr.title.replace(/"/g, '\\"');
					frontmatter['url'] = pr.html_url;
					frontmatter['repository'] = repoFullName;
					frontmatter['repository_url'] = `https://github.com/${repoFullName}`;
					frontmatter['owner'] = `https://github.com/${repoOwner}`;
					frontmatter['pr_number'] = pr.number;
					frontmatter['state'] = pr.state;
					frontmatter['draft'] = pr.draft || false;
					frontmatter['closed_at'] = pr.closed_at || 'Not closed';
					frontmatter['merged_at'] = (pr.pull_request?.merged_at || pr.merged_at) || 'Not merged';
					frontmatter['lastUpdated'] = new Date().toLocaleString();
				});
			}
		} catch (error) {
			console.error(`Error creating note for PR #${pr.number}:`, error);
		}

		return !exists;
	}
}


class GitHubSettingTab extends PluginSettingTab {
	plugin: GitHubPlugin;

	constructor(app: App, plugin: GitHubPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('GitHub API token')
			.setDesc('Personal access token (https://github.com/settings/personal-access-tokens) with starring::read')
			.addText(text => {
				text.setPlaceholder('Enter your personal access token')
					.setValue(this.plugin.settings.apiToken);
				text.inputEl.type = 'password';
				text.onChange(async (value) => {
					this.plugin.settings.apiToken = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('GitHub username')
			.setDesc('Your username in GitHub')
			.addText(text => text
				.setPlaceholder('Enter your username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync stars')
			.setDesc('Allow automatic and manual syncing of GitHub data')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncEnabled)
				.onChange(async (value) => {
					this.plugin.settings.syncEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Stars directory')
			.setDesc('Directory where GitHub data will be stored')
			.addSearch(cb => {
				try {
					new DirSuggest(this.app, cb.inputEl);
				} catch (e) {
					new Notice(e.toString(), 3000);
				}
				cb.setPlaceholder('Example: dir1/dir2')
					.setValue(this.plugin.settings.targetDirectory)
					.onChange(async (dir) => {
						this.plugin.settings.targetDirectory = dir;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Use default template for Stars')
			.setDesc('Use the built-in template for rendering Stars')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useDefaultTemplateStar)
				.onChange(async (value) => {
					this.plugin.settings.useDefaultTemplateStar = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName('Custom template file for Stars')
			.setDesc('Path to a note inside the vault to use as template for new files')
			.addSearch(cb => {
				try {
					new FileSuggest(this.app, cb.inputEl);
				} catch (e) {
					new Notice(e.toString(), 3000);
				}
				cb.setPlaceholder('Example: Templates/GitHub Star.md')
					.setValue(this.plugin.settings.templatePathStar)
					.onChange(async (path) => {
						this.plugin.settings.templatePathStar = path;
						await this.plugin.saveSettings();
					});
				// Disable when using default template
				cb.inputEl.disabled = this.plugin.settings.useDefaultTemplateStar;
			});

		let lastFetchDate = 'never';
		if (this.plugin.settings.lastFetchDate) {
			lastFetchDate = new Date(this.plugin.settings.lastFetchDate).toLocaleString();
		}

		new Setting(containerEl)
			.setName('Force fetch stars')
			.setDesc(`Re-fetch all starred repos. Last fetched on: ${lastFetchDate}`)
			.addButton(button => button
				.setButtonText('Fetch stars')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.lastFetchDate = ""
					await this.plugin.saveSettings()
					await this.plugin.fetchStars();
					// Refresh the settings view to show updated last fetch date
					this.display();
				}));

		new Setting(containerEl)
			.setName('Sync pull requests')
			.setDesc('Also sync pull requests authored by the user')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncPullRequests)
				.onChange(async (value) => {
					this.plugin.settings.syncPullRequests = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Pull requests directory')
			.setDesc('Directory where pull request notes will be stored (leave empty to use same as stars)')
			.addSearch(cb => {
				try {
					new DirSuggest(this.app, cb.inputEl);
				} catch (e) {
					new Notice(e.toString(), 3000);
				}
				cb.setPlaceholder('Example: PRs or GitHub/PRs')
					.setValue(this.plugin.settings.prDirectory)
					.onChange(async (dir) => {
						this.plugin.settings.prDirectory = dir;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Use default template for PR')
			.setDesc('Use the built-in template for rendering Pull Requests')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useDefaultTemplatePR)
				.onChange(async (value) => {
					this.plugin.settings.useDefaultTemplatePR = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName('Custom template file for PR')
			.setDesc('Path to a note inside the vault to use as template for new files')
			.addSearch(cb => {
				try {
					new FileSuggest(this.app, cb.inputEl);
				} catch (e) {
					new Notice(e.toString(), 3000);
				}
				cb.setPlaceholder('Example: Templates/GitHub PR.md')
					.setValue(this.plugin.settings.templatePathPR)
					.onChange(async (path) => {
						this.plugin.settings.templatePathPR = path;
						await this.plugin.saveSettings();
					});
				// Disable when using default template
				cb.inputEl.disabled = this.plugin.settings.useDefaultTemplatePR;
			});

		let lastPRFetchDate = 'never';
		if (this.plugin.settings.lastPRFetchDate) {
			lastPRFetchDate = new Date(this.plugin.settings.lastPRFetchDate).toLocaleString();
		}

		new Setting(containerEl)
			.setName('Force fetch pull requests')
			.setDesc(`Re-fetch all Pull Requests. Last fetched on: ${lastPRFetchDate}`)
			.addButton(button => button
				.setButtonText('Fetch PRs')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.lastPRFetchDate = ""
					await this.plugin.saveSettings()
					await this.plugin.fetchPullRequests();
					// Refresh the settings view to show updated last fetch date
					this.display();
				}));
	}
}

// normalizeTag will replace all "not supported" symbols to '_' and make string lower-case.
function normalizeTag(tag: string): string {
	return tag
		.toLowerCase()
		.replace(/[^a-z0-9/_-]/g, '_');
}
