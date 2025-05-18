import {App, Notice, Plugin, PluginSettingTab, Setting, TFile} from 'obsidian';
import {requestUrl, RequestUrlParam} from 'obsidian';
import { DirSuggest } from 'suggest';


interface GitHubPluginSettings {
	apiToken: string;
	username: string;
	targetDirectory: string;
	lastFetchDate: string;
}

const DEFAULT_SETTINGS: GitHubPluginSettings = {
	apiToken: '',
	username: '',
	targetDirectory: '',
	lastFetchDate: '',
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

export default class GitHubPlugin extends Plugin {
	settings: GitHubPluginSettings;

	async onload() {
		await this.loadSettings();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'github-fetch-stars-force',
			name: 'Force fetch all stars',
			callback: async () => {
				this.settings.lastFetchDate = ""
				await this.saveSettings()
				await this.fetchStars();
			}
		});

		this.addCommand({
			id: 'github-fetch-stars',
			name: 'Fetch stars',
			callback: async () => {
				await this.fetchStars();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GitHubSettingTab(this.app, this));

		// Check if settings are ready to fetch stars when plugin loads
		if (this.settingsAreValid()) {
			this.fetchStars();
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
		if (!this.settingsAreValid()) {
			new Notice('Please set both GitHub username and target directory in settings');
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

		// Build tags list starting with default github tag
		const tagsList = ['type/github-star'];

		// Add language as a tag if present
		if (repo.language) {
			tagsList.push(`github/language/${repo.language.toLowerCase()}`)
		}

		// Add repository topics if they exist
		for (const topic of repo.topics || []) {
			tagsList.push(`github/topic/${topic}`)
		}

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
				// Create new file with minimal content
				const initialContent = `# ${repo.name}\n\n`;
				file = await vault.create(fileName, initialContent);
			}

			// Use the same API for both new and existing files
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter['tags'] = tagsList;
				frontmatter['aliases'] = repo.name;
				frontmatter['description'] = (repo.description || 'No description').replace(/"/g, '\\"');
				frontmatter['url'] = repo.html_url;
				frontmatter['owner'] = `https://github.com/${repo.owner.login}`;
				frontmatter['language'] = repo.language || 'Not specified';
				frontmatter['stars'] = repo.stargazers_count;
				frontmatter['created'] = createdFormatted;
				frontmatter['modified'] = modifiedFormatted;
				frontmatter['lastUpdated'] = new Date().toLocaleString();
			});
		} catch (error) {
			console.error(`Error creating note for ${repo.name}:`, error);
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
			.setDesc('GitHub username')
			.addText(text => text
				.setPlaceholder('Enter your username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Target directory')
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
					  await	this.plugin.saveSettings();
					});
			});

		// Display last fetch date if available
		if (this.plugin.settings.lastFetchDate) {
			const lastFetchDate = new Date(this.plugin.settings.lastFetchDate);
			new Setting(containerEl)
				.setName('Last fetch')
				.setDesc(`Stars were last fetched on ${lastFetchDate.toLocaleString()}`);
		}

		new Setting(containerEl)
			.setName('Force fetch stars')
			.setDesc('Manually trigger re-fetching starred repositories')
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
	}
}
