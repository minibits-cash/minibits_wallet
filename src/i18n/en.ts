const en = {
  common: {
    ok: "OK",    
    cancel: "Cancel",
    close: "Close",
    back: "Back",
    paste: "Paste",
    scan: "Scan",
    copy: "Copy",
		copyFailParam: "Couldn't copy %{param}", 
    confirm: "Confirm",
    save: "Save",
    add: "Add",
		success: "Success!",
    offline: "Offline",
		qr: "QR Code",
		sats: "SATS",
		notCreated: 'Not yet created',
		resetDefault: 'Reset to default',
		share: "Share",
  },
	paymentCommon: {
		pay: "Pay",
		payMe: 'Pay me',		
		payFromWallet: 'Pay from wallet',
		receiveInPerson: "Receive in person"
	},
	transactionCommon: {
		from: "From %{sender}",
		receivedFrom: "Received from %{sender}",
		sentTo: "Sent to %{receiver}",
		paidTo: "Paid to %{receiver}",
		youReceived: 'You received',
		youSent: 'You sent',
		youPaid: 'You paid',
		unknown: 'Unknown transaction',
		status: {
			completedFee: 'Completed %{fee}',
			draft: 'Draft',
			error: 'Error',
			pending: 'Pending',
			prepared: 'Prepared',
			reverted: 'Reverted',
			blocked: 'Blocked',
			expired: 'Expired'
		},
		tapToRedeem: 'Tap to redeem',
		redeemOnline: 'Redeem online',
    feePaid: 'Paid fee'
	},
  welcomeScreen: {
    page1: {
      heading: "Welcome",
      intro: "Minibits is an ecash and Lightning wallet with a focus on performance and usability. Ecash is a bearer token issued by custodians known as mints.",
      bullet1: "Minibits follows the Cashu protocol, where mints back ecash with Bitcoin.",
      bullet2: "Ecash is issued or exchanged back to Bitcoin instantly through Lightning payments.",
      bullet3: "Ecash tokens are stored on-device; mints do not keep ledger or wallet balances.",
      final: "No Watson, there is no blockchain."
    },
    page2: {
      heading: "Why Minibits?",
      intro: "Minibits' aim is to research how Lightning and ecash can be integrated into a seamless and instant experience that can work at scale and still provide good privacy.",
      bullet1: "Minibits provides sharable wallet identifiers using NOSTR addresses. Like account numbers, just better.",
      bullet2: "Try in-person sends while devices are offline - ecash settles when back online (Proof of concept).",
      bullet3: "You can opt-in for storage encryption and biometric authentication.",
      final: "Minibits is free and open-source software; find us on Github for the roadmap and contributions."
    },
    page3: {
      heading: "Do not forget",
      intro: "Both the Cashu protocol and the Minibits wallet are still experimental, and by using them, you accept known and unknown risks.",
      bullet1: "Mints are, by design, custodial services. Run your own or use them only for research and testing purposes.",
      bullet2: "Ecash is stored on your device, so the loss of the device means the loss of ecash. Remote backup protocol is still under research.",
      bullet3: "Minibits provides its own mint that you can use for testing purposes with small amounts. It is operated on a best-effort basis and without any guarantees.",
      final: "Now, let's move some ecash!",
      go: "Let's go!"
    }  
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
		feeBadge: {
			final: "+ final fee %{fee} %{code}",
			upto: "+ fee up to %{fee} %{code}"
		}
  },
  receiveScreen: {
    title: "Receive", 
    paste: "Paste ecash",
    receive: "Receive",
    receiveOffline: "Receive offline",    
    newMintsAdded: {
      one: "{{count}} mint has been added to your wallet",
      other: "{{count}} mints have been added to your wallet",
    },
    toReceive: "Amount to receive",
    received: "Amount received",
    sharePaymentRequest: "Send payment request",
    sharePaymentRequestDescription: "Send payment request to one of your contacts, so that the payer can pay you exact amount.",
    scanToReceive: "Scan or paste to receive",
    scanToReceiveDescription: "Scan or paste ecash token or lnurl withdraw link to receive into your wallet.",
    pasteToReceive: "Paste",
    pasteoReceiveDescription: "Paste ecash token to receive it into your wallet.",
    showOrShareInvoice: "Share lightning invoice",
    showOrShareInvoiceDescription: "Present or share lightning invoice for an amount you want to receive." ,
    scanWithdrawalLink: "Scan withdrawal link"   
  },
  transferScreen: {
    
  },
  topupScreen: {
    
  },
  sendScreen: {
    title: "Send",
    sendToContact: "Send to contact",
    sendToContactDescription: "Send your ecash to one of your contacts stored in your contact list.",
    scanToPay: "Scan to pay",
    scanToPayDescription: "Scan Lightning invoice, LNURL pay code or Lightning address to pay.",
    pasteToSend: "Paste",
    pasteToSendDescription: "Paste lightning invoice from clipboard to pay it from your wallet.",
    showOrShareToken: "Share ecash",
    showOrShareTokenDescription: "Present or share ecash token for an amount you want to send.",
  },
  tranDetailScreen: {
    amount: "Amount",
    lightningFee: "Lightning network fee",
    memoFromSender: "Memo from sender",
    sentFrom: "Sent from",
    sentTo: "Sent to",
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
    topupTo: "Topup to",
    trasferredTo: "Paid to",
    invoice: "Lightning invoice to pay",
    receiveOfflineComplete: "Redeem to wallet",
    isOffline: "Redeem online"
  },
  contactsScreen: {    
    new: "New",
    scan: "Scan",
    newTitle: "Add new contact",
		getInvoice: "Get invoice",
		ownName: {
			donationSuccess: "Thank you! Donation for %{receiver} has been successfully paid.",  
			tooShort: 'Write your wallet profile name to the text box, use min 2 characters.',
			illegalChar: 'Do not use . or - characters at the beginning or the end of name.',
			profileExists: 'This wallet name is already in use, choose another one.',
			chooseOwnName: 'Choose your own name',
			chooseOwnNameFooter: 'Use lowercase letters, numbers and .-_',
			available: "%{name} is available!",
			payToGetOwnName: "Pay the following lightning invoice and get your %{name} wallet name.",
			ctaPay: "Pay from wallet",
			insufficient: 'Your wallet balance is not enough to pay this invoice amount but you can still pay it from another wallet.',
			betaWarning: 'Please accept this is an early beta software. Your data can still be lost due to a bug or unexpected data loss.'
		},
		privateContacts: {
			selectSendPaymentRequest: 'Select contact to send your payment request to.',
			selectSendToken: 'Select contact to send your ecash to.',
			selectSendLnURL: 'Select contact to send Lightning payment to.',
			saveNewFormat: "Please enter a wallet address in name@domain.xyz format",
			profileNotFound: "Profile name %{name} could not be found. Make sure the name is correct.",
			noLightningAddress: 'This contact does not have a Lightning address, send ecash instead.',
			explainerText: "Private contacts",
			explainerSubText: "Add other Minibits users as your private contacts. Every user gets sharable @minibits.cash wallet address. You can pay privately to your contacts anytime even if they are offline.",
			switchName: "Switch your wallet name and picture?",
			switchNameSubText: 'Get cooler wallet name or profile picture. Select from an array of random names and images or opt for your own @minibits.cash wallet name.',
			bottomModal: "Private contacts are unique identifiers of other Minibits wallets. You can use them to send or request ecash and you can safely share your own with others.",
			domainMinibits: "Use minibits.cash domain",
			domainExternal: "Use another domain"
		},
		publicContacts: {
			npubPasteError: 'Copy your NPUB key first, then paste',
			relayurlPasteError: 'Copy your relay URL key first, then paste',
			relayExists: 'Relay already exists.',
			missingLightningAddress: 'This contact does not have a Lightning address, send ecash instead.',
			nostrTip: 'Tip the people you follow',
			nostrTipSubText: 'Add your NOSTR social network public key (npub) and tip or donate to your favourite people and projects directly from the minibits wallet.',
			nostrSetPublicKey: 'Set your public key',
			nostrSetPublicKeySubText: 'Add or change your NOSTR social network public key (npub).',
			nostrSetRelay: 'Set relay',
			nostrSetRelaySubText: 'Add or change your own relay if your profile and follows are not hosted on the default relays.',
			nostrRemovePub: 'Remove your public key',
			nostrRemovePubSubText: 'Remove your npub key and stop loading public contacts.',
			addNpub: 'Add your npub key',
			pasteDemoKey: 'Paste demo key',
			setOwnRelay: 'Set your own relay'
		},
		randomName: {
			selectOneOfUsernames: 'Select one of the usernames'
		}
  },
	paymentRequestScreen: {
		incoming: {
			noRequests: 'There are no incoming payment requests to be paid or they have already expired.'
		},
		outgoing: {
			noRequests: 'There are no outgoing payment requests to be paid or they have already expired.',
			invoiceShared: 'Lightning invoice has been shared, waiting to be paid by receiver.',
			sharingCancelled: 'Sharing cancelled',
			scanAndPay: 'Scan and pay to top-up'
		},
		// might move this to common later if it gets used in other screens
		listItem: {
			expires: "Expires",
			expired: "Expired",
			requestPaymentSuccess: 'Request has been paid'
		}
	},

  profileScreen: {    
    changeAvatar: "Change picture",
    changeAvatarSubtext: "Select one from randomly generated pictures.",
    changeWalletaddress: "Change wallet address",
    changeWalletaddressSubtext: "Change unique wallet address. Select one of randomly generated or choose your own.",
  },
  settingsScreen: {
    title: "Settings", 
    manageMints: "Manage mints",
    preferredUnit: "Preferred unit",
    mintsCount: {
      one: "{{count}} mint",
      other: "{{count}} mints",
    },
    go: "Let's go!",
    backupRecovery: "Backup and recovery",
    security: "Security",
    privacy: "Privacy",
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
    mintBlocked: "The mint has been blocked. The app will not receive ecash from this mint.",
    mintUnblocked: "The mint has been unblocked. You can now receive ecash from this mint."
  },
  backupScreen: {
    localBackup: "Local backup",
    localBackupDescription: "Local backup stores a copy of all your ecash in the local database. Ecash is never deleted unless you switch off the backup. Please note that this backup is not encrypted.",
    remoteBackup: "Seed backup",
    remoteBackupDescription: "Mnemonic phrase encodes your seed and allows you to recover your ecash balance in case of device loss.",
    recoveryTool: "Local recovery tool",
    recoveryToolDescription: "Show ecash backed up in the local database and attempt to recover unspent ones into the wallet in case the wallet storage gets corrupted or a transaction fails due to an unexpected error.",
    removeSpentCoins: "Remove spent ecash",
    removeSpentCoinsDescription: "In case of a SEND or TRANSFER transaction error, spent ecash may remain in your wallet. This blocks further transactions with the mint, making the wallet unusable. This tool removes spent ecash from the wallet."
  },
  securityScreen: {
    encryptStorage: "Encrypt storage",
    encryptStorageDescription: "Encrypt the storage that stores your ecash with the secret key generated on your device. Experimental, not recommended for every day use.",
    biometry: "Biometric authentication",
    biometryAvailable: "Biometric authentication is now required for Minibits to start and unlock the encryption key.",
    biometryNone: "You have not setup biometric authentication or your device does not support it.",
  },
  privacyScreen: {    
    torDaemon: "Use Tor network",
    torDaemonDescription: "Allow connections with mints through Tor .onion addresses.",
    torStatus: "Tor status",
    logger: "Enable logging",
    loggerDescription: "Log anonymous error information in order to identify and fix wallet bugs during beta testing. Switch off for best privacy.",
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
    info: "About Minibits wallet",
    logLevel: "Log level"
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
