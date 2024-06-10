const fs = require('fs');
const path = require('path');
const messagesFolder = path.resolve(__dirname, '../src/i18n_messages');

for (const file of fs.readdirSync(messagesFolder)) {
  const filePath = path.join(messagesFolder, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('${')) {
      const index = line.indexOf('${');
      const neighborValue = 10
      const neighbor = line
        .trim()
        .slice(
          Math.max(0, index - neighborValue),
          Math.min(line.length, index + neighborValue),
        )
      console.log(`${filePath}(${i+1},${index+1}): Likely incorrect placeholder selector \$\{\}: ...${neighbor}...`);
    }
  }
}