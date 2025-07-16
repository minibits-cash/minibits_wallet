const fs = require('fs');
const path = require('path');

console.log('TRANSLATION ANALYSIS');
console.log('=' + '='.repeat(50));

// First, run the translation analysis
try {
	// Read settings.json to get language configuration
	const settingsPath = path.join(__dirname, '..', 'minibits.inlang', 'settings.json');
	const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
	const defaultLanguage = settings.sourceLanguageTag;
	const allLanguages = settings.languageTags;

	console.log(`Default language: ${defaultLanguage}`);
	console.log(`All languages: ${allLanguages.join(', ')}`);
	console.log('=' + '='.repeat(50));

	// Load all translation files
	const translations = {};
	const i18nMessagesPath = path.join(__dirname, '..', 'src', 'i18n_messages');

	allLanguages.forEach(lang => {
		const filePath = path.join(i18nMessagesPath, `${lang}.json`);
		if (fs.existsSync(filePath)) {
			try {
				translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			} catch (error) {
				console.error(`Error reading ${lang}.json:`, error.message);
				translations[lang] = {};
			}
		} else {
			console.warn(`Translation file not found: ${lang}.json`);
			translations[lang] = {};
		}
	});

	// Get keys from default language
	const defaultKeys = Object.keys(translations[defaultLanguage] || {});
	const totalKeys = defaultKeys.length;

	console.log(`Total keys in default language (${defaultLanguage}): ${totalKeys}`);
	console.log('=' + '='.repeat(50));

	// Check each language
	for (const lang of allLanguages) {
		if (lang === defaultLanguage) {
			console.log(`\n${lang.toUpperCase()} (default language)`);
			console.log(`✅ 100% translated (${totalKeys}/${totalKeys} keys)`);
			continue;
		}

		const currentKeys = Object.keys(translations[lang] || {});
		const currentTotal = currentKeys.length;
		const missingKeys = defaultKeys.filter(key => !translations[lang].hasOwnProperty(key));
		const percentcageTranslated = totalKeys > 0 ? Math.round((currentTotal / totalKeys) * 100) : 0;
		
		console.log(`\n${lang.toUpperCase()}`);
		console.log(`📊 ${percentcageTranslated}% translated (${currentTotal}/${totalKeys} keys)`);
		
		if (missingKeys.length === 0) {
			console.log('✅ No missing keys!');
		} else {
			console.log(`❌ Missing ${missingKeys.length} keys:`);
			const maxToShow = 25;

			for (const [i, key] of missingKeys.entries()) {
				if (i >= maxToShow) break;
				console.log(`   - ${key}`);
			}

			if (missingKeys.length > maxToShow) {
				console.log(`   ...and ${missingKeys.length - maxToShow} more. (fix these first)`);
			}

		}
	}

	console.log('\n' + '=' + '='.repeat(50));
	console.log('✅ Translation analysis complete!');
} catch (translationError) {
	console.error('❌ Error during translation analysis:', translationError.message);
}

console.log('\n' + '=' + '='.repeat(50));
  // Read settings.json to get language configuration
  const settingsPath = path.join(__dirname, '..', 'minibits.inlang', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
