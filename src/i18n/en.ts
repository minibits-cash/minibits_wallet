const en = {
  common: {
    ok: "OK",
    cancel: "Cancel",
    close: "Close",
    back: "Back",
    paste: "Paste",
    scan: "Scan",
    copy: "Copy",
    offline: "Offline",
  },
  welcomeScreen: {
    heading: "Welcome to Minibits",
    intro: "Minibits is an e-cash wallet with a focus on performance and usability for non-techies. Cash is backed by Bitcoin via the Cashu protocol and Lightning Network.",
    warning1: "This wallet should be used for research purposes only.",
    warning2: "The wallet is an alpha version with incomplete functionality and both known and unknown bugs.",
    warning3: "Do not use it with large amounts of coins.",
    warning4: "Start by connecting to the mint you trust or by receiving coins from another e-cash Cashu wallet.",
    warning5: "Visit github.com/minibits-cash to give your feedback.",
    go: "Let's go!"
  },
  walletScreen: {
    fund: "Fund wallet",
    withdraw: "Withdraw",
    send: "Send",
    receive: "Receive",
    topUpWallet: "Top up wallet",
    topUpWalletSubText: "Top up your balance by paying Bitcoin lightning invoice from another wallet",
    transferFromWallet: "Transfer from wallet",
    transferFromWalletSubText: "Debit your balance by paying Bitcoin lightning invoice from this wallet",
  },
  receiveScreen: {
    title: "Receive", 
    paste: "Paste coin",
    receive: "Receive",
    newMintsAdded: {
      one: "{{count}} mint has been added to your wallet",
      other: "{{count}} mints have been added to your wallet",
    },
    toReceive: "Amount to receive",
    received: "Amount received:",
    sharePaymentRequest: "Share payment request",
    sharePaymentRequestDescription: "Share the amount and contact information as a link or QR code, so that the payer can pay you the requested amount.",
    scanQRCodeToReceive: "Scan QR code to receive",
    scanQRCodeToReceiveDescription: "If you see the coins in QR code format on another device, scan it to receive.",
    pasteFromClipboard: "Paste from clipboard",
    pasteFromClipboardDescription: "If you've received your coins through any other app, paste them here to receive."    
  },
  transferScreen: {
    pasteLightningInvoice: "Paste lightning invoice",
    pasteLightningInvoiceDescription: "Paste the Bitcoin lightning invoice you want to pay. The mint will pay this invoice on your behalf in exchange for the coins from your wallet.",
    scanLightningInvoice: "Scan lightning invoice",
    scanLightningInvoiceDescription: "Scan the Bitcoin lightning invoice in QR code format. You can use your coins to pay any service supporting lightning payments."
  },
  topupScreen: {
    sendInvoiceToContact: "Send invoice to contact",
    sendInvoiceToContactDescription: "Send a lightning invoice to one of your contacts so they can top up your balance by paying it.",
    showInvoiceQRCode: "Show invoice QR code",
    showInvoiceQRCodeDescription: "Present the lightning invoice as a QR code so that you can pay it from the wallet on another device.",
    shareInvoiceAsText: "Share invoice as text",
    shareInvoiceAsTextDescription: "Copy and share the invoice with anybody through a secure app of your choice."
  },
  sendScreen: {
    sendToContact: "Send to contact",
    sendToContactDescription: "Send your coins to one of your contacts stored in your contact list.",
    showAsQRCode: "Show as QR code",
    showAsQRCodeDescription: "Present the coins as a QR code so that the recipient can scan it to receive them.",
    shareAsText: "Share as text",
    shareAsTextDescription: "Copy and send the coins to anybody through a secure app of your choice."
  },
  tranDetailScreen: {
    amount: "Amount (in satoshis)",
    memoFromSender: "Memo from sender",
    sentFrom: "Sent from",
    type: "Type",
    status: "Status",
    balanceAfter: "Balance after this transaction",
    createdAt: "Created at",
    id: "ID",    
    memoToReceiver: "Memo to receiver",
    revert: "Revert",
    claim: "Claim",
    memoFromInvoice: "Memo from invoice",
    paidFrom: "Paid from",
    receivedTo: "Received to",
  },
  settingsScreen: {
    title: "Settings", 
    manageMints: "Manage mints",
    mintsCount: {
      one: "{{count}} mint",
      other: "{{count}} mints",
    },
    go: "Let's go!",
    backupRecovery: "Backup and recovery",
    security: "Security",
    devOptions: "Developer options", 
    update: "Update manager"
  },
  mintsScreen: {
    addMintUrl: "Add mint URL",    
    mintUrl: "Mint URL",
    mintUrlHint: "Provide the URL of a trusted mint",
    invalidUrl: "This is not a valid URL",
    mintExists: "This mint already exists",
    addMint: "Add mint",
    mintAdded: "The mint has been added",
    mintInfo: "Mint information page",
    rename: "Rename mint",
    setColor: "Change the mint's icon color",
    copy: "Copy mint URL",
    removeMint: "Remove mint",
    blockMint: "Block receiving from this mint",
    unblockMint: "Unblock receiving from this mint",
    mintRemoved: "The mint has been removed",
    mintBlocked: "The mint has been blocked. The app will not receive coins from this mint.",
    mintUnblocked: "The mint has been unblocked. You can now receive coins from this mint."
  },
  backupScreen: {
    localBackup: "Local backup",
    localBackupDescription: "Local backup stores a copy of all your coins in the local database. Coins are never deleted unless you switch off the backup. Please note that this backup is not encrypted.",
    recoveryTool: "Recovery tool",
    recoveryToolDescription: "Show coins backed up in the local database and attempt to recover unspent ones into the wallet in case the wallet storage gets corrupted or a transaction fails due to an unexpected error.",
    removeSpentCoins: "Remove spent coins",
    removeSpentCoinsDescription: "In case of a SEND or TRANSFER transaction error, spent coins may remain in your wallet. This blocks further transactions with the mint, making the wallet unusable. This tool removes spent coins from the wallet."
  },
  securityScreen: {
    encryptStorage: "Encrypt storage",
    encryptStorageDescription: "Encrypt the storage that stores your coins with the secret key generated on your device and stored in secure keys storage. On some Android devices, this may cause a slightly longer startup of the application.",
    biometry: "Biometric authentication",
    biometryAvailable: "Your device supports biometric authentication. If you activate encrypted storage, it will be required for Minibits to start.",
    biometryNone: "You have not setup biometric authentication or your device does not support it."
  },
  updateScreen: {
    updateAvailable: "Update is available",
    nativeUpdateAvailableDesc: "There is a new version of Minibits Wallet in the Google Play Store.",
    gotoPlayStore: 'Visit Play Store',
    updateNow: 'Update and restart',
    updateAvailableDesc: "There is a new Over-the-Air update of Minibits Wallet ready to download and install.",
    updateNew: "What's new?",
    updateSize: "Download size",
    updateNotAvailable: 'Nothing to update',
    updateNotAvailableDesc: 'Good, you are running the latest version of the app.'
  },
  developerScreen: {
    title: "Developer options", 
    transactions: "Sync recent transactions",
    transactionsDescription: "There are {{count}} recent transactions cached in the app's fast storage. Resetting will reload them from the app's database. Do only during development or testing.",
    reset: "Factory reset",
    resetDescription: "This will wipe out all local data from storage and from the local database. Do only during development or testing.",
    go: "Let's go!",
    devOptions: "Developer options", 
    info: "About Minibits wallet"
  },
  errorScreen: {
    title: "Something went wrong!",
    friendlySubtitle:
      "Unfortunately, the Minibits app encountered an unexpected error. Please contact us at support@minibits.cash or raise an issue on Github.",
    reset: "RESET APP",
  },
  tabNavigator: {
    walletLabel: "Wallet",      
    contactsLabel: "Contacts",
    settingsLabel: "Settings",
  },
};

export default en;
export type Translations = typeof en;
