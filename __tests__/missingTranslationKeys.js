const { exec } = require('child_process');
console.log('TYPESCRIPT ERROR CHECK');
console.log('=' + '='.repeat(50));

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