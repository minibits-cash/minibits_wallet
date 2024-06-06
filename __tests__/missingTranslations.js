const { exec } = require('child_process');

exec('tsc --noEmit', (error, stdout, stderr) => {
  if (error) {
    const output = stdout;
    const filteredErrors = output.split('\n').filter(line => line.includes('TxKeyPath'));
    if (filteredErrors.length > 0) {
      console.log(filteredErrors.join('\n'));
    } else {
      console.log('No errors containing TxKeyPath found.');
    }
    // process.exit(1); // Ensure the script returns an error code if there were any errors
  } else {
    console.log('No TypeScript errors found.');
  }
});
