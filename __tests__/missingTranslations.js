const { exec } = require('child_process');
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
  allLanguages.forEach(lang => {
    if (lang === defaultLanguage) {
      console.log(`\n${lang.toUpperCase()} (default language)`);
      console.log(`✅ 100% translated (${totalKeys}/${totalKeys} keys)`);
      return;
    }

    const currentKeys = Object.keys(translations[lang] || {});
    const currentTotal = currentKeys.length;
    const missingKeys = defaultKeys.filter(key => !translations[lang].hasOwnProperty(key));
    const percentageTranslated = totalKeys > 0 ? Math.round((currentTotal / totalKeys) * 100) : 0;
    
    console.log(`\n${lang.toUpperCase()}`);
    console.log(`📊 ${percentageTranslated}% translated (${currentTotal}/${totalKeys} keys)`);
    
    if (missingKeys.length > 0) {
      console.log(`❌ Missing ${missingKeys.length} keys:`);
      missingKeys.forEach(key => {
        console.log(`   - ${key}`);
      });
    } else {
      console.log(`✅ No missing keys!`);
    }
  });

  console.log('\n' + '=' + '='.repeat(50));
  console.log('✅ Translation analysis complete!');
} catch (translationError) {
  console.error('❌ Error during translation analysis:', translationError.message);
}

console.log('\n' + '=' + '='.repeat(50));
console.log('TYPESCRIPT ERROR CHECK');
console.log('=' + '='.repeat(50));

// Now run the TypeScript error checking
exec('tsc --noEmit', (error, stdout) => {
  if (error) {
    const output = stdout;
    const filteredErrors = output.split('\n').filter(line => line.includes('TxKeyPath'));
    if (filteredErrors.length > 0) {
      console.log('❌ TypeScript errors containing TxKeyPath found:');
      console.log(filteredErrors.join('\n'));
    } else {
      console.log('✅ No TypeScript errors containing TxKeyPath found.');
    }
  } else {
    console.log('✅ No TypeScript errors found.');
  }
});
