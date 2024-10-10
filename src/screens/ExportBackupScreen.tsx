import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  Switch,
} from 'react-native'
import {btoa, fromByteArray} from 'react-native-quick-base64'
import {useThemeColor, spacing, typography} from '../theme'
import {
  Button,
  Icon,
  Screen,
  Text,
  Card,
  ListItem,
  ErrorModal,
  InfoModal,
  Loading,
} from '../components'
import {SettingsStackScreenProps} from '../navigation'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError from '../utils/AppError'
import { Proof } from '../models/Proof'
import { useStores } from '../models'
import { CashuUtils, ProofV3, TokenV3 } from '../services/cashu/cashuUtils'
import Clipboard from '@react-native-clipboard/clipboard'
import { MintUnits, getCurrency } from '../services/wallet/currency'
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { translate } from '../i18n'
import { ProofsStoreSnapshot } from '../models/ProofsStore'
import { getSnapshot } from 'mobx-state-tree'
import { ContactsStoreSnapshot } from '../models/ContactsStore'
import { MintsStoreSnapshot } from '../models/MintsStore'
import { TransactionsStoreSnapshot } from '../models/TransactionsStore'

interface ExportBackupScreenProps extends SettingsStackScreenProps<'ExportBackup'> {}


export const ExportBackupScreen: FC<ExportBackupScreenProps> =
    function ExportBackup(_props) {

    const { navigation } = _props
    const { 
        mintsStore, 
        contactsStore, 
        transactionsStore, 
        proofsStore 
    } = useStores()

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isEcashInBackup, setIsEcashInBackup] = useState(false)
    const [isMintsInBackup, setIsMintsInBackup] = useState(false)
    const [isContactsInBackup, setIsContactsInBackup] = useState(false)
    const [isTransactionsInBackup, setIsTransactionsInBackup] = useState(false)
    
    useEffect(() => {
        const loadProofs = async () => {            
            setIsLoading(true)
            // full refresh of proofs from DB in case the state is broken
            await proofsStore.loadProofsFromDatabase()
            setIsLoading(false)
        }

        loadProofs()
        return () => {}
    }, [])

    
    const toggleBackupEcashSwitch = () =>
        setIsEcashInBackup(previousState => !previousState)

    
    const toggleBackupMintsSwitch = () =>
        setIsMintsInBackup(previousState => !previousState)

    
    const toggleBackupContanctsSwitch = () =>
        setIsContactsInBackup(previousState => !previousState)

    
    const toggleBackupTransactionsSwitch = () =>
        setIsTransactionsInBackup(previousState => !previousState)


    const copyBackup = function () {
        try {       
            let Proofs: ProofsStoreSnapshot = {
                proofs: [], 
                pendingProofs: [], 
                pendingByMintSecrets: []
            }

            let Mints: MintsStoreSnapshot = {
                mints: [], 
                blockedMintUrls: [], 
                counterBackups: []
            }

            let Contacts: ContactsStoreSnapshot = {
                contacts: [], 
                publicPubkey: undefined, 
                selectedContact: undefined, 
                receivedEventIds: [], 
                lastPendingReceivedCheck: undefined
            }            

            let Transactions: TransactionsStoreSnapshot = {
                transactions: []
            }

            if(isEcashInBackup) {
                Proofs = getSnapshot(proofsStore)                
            }

            if(isMintsInBackup) {                
                Mints = getSnapshot(mintsStore)
            }

            if(isContactsInBackup) {
                Contacts = getSnapshot(contactsStore)
            }

            if(isTransactionsInBackup) {
                Transactions = getSnapshot(transactionsStore)
            }

            const base64Encoded = btoa(JSON.stringify({Proofs, Mints, Contacts, Transactions}))            
            Clipboard.setString(base64Encoded)

        } catch (e: any) {
            setInfo(`Could not encode and copy wallet backup: ${e.message}`)
        }
    }


    const groupProofsByMint = function (proofs: Proof[]) {
      return proofs.reduce((acc: Record<string, Proof[]>, proof) => {
        
        const proofMint = CashuUtils.getMintFromProof(proof, mintsStore.allMints)
        // Check if there's already an array for this keyset, if not, create one
        if(!proofMint) {
          return acc
        }
  
        if (!acc[proofMint.mintUrl]) {
          acc[proofMint.mintUrl] = []
        }                 
        
        // Push the object into the array corresponding to its keyset
        acc[proofMint.mintUrl].push(proof)
        return acc
      }, {})
    }
  
    const groupProofsByKeysets = function (proofsByMint: Proof[]) {
      return proofsByMint.reduce((acc: Record<string, Proof[]>, proof) => {
        // Check if there's already an array for this keyset, if not, create one
        if (!acc[proof.id as string]) {
          acc[proof.id] = []
        }                 
        
        // Push the object into the array corresponding to its keyset
        acc[proof.id].push(proof)
        return acc;
      }, {})
    }


    const copyEncodedTokens = function () {
        try {
            setIsLoading(true)
            const encodedTokens: string[] = []

            if (mintsStore.allMints.length === 0) {
              setInfo(translate("missingMintsForProofsUserMessage"))
            }

            const groupedByMint = groupProofsByMint(proofsStore.proofs)

            for (const mint in groupedByMint) { 
              
              const proofsByMint = groupedByMint[mint]

              if(proofsByMint.length === 0) {
                continue
              }

              const groupedByKeyset = groupProofsByKeysets(proofsByMint)

              for (const keysetId in groupedByKeyset) {
                const proofsByKeysetId = groupedByKeyset[keysetId]
                const proofsToExport: ProofV3[] = []

                for (const p of proofsByKeysetId) {
                  // clean private params
                  const proofToExport: ProofV3 = {
                    id: p.id,
                    amount: p.amount,
                    secret: p.secret,
                    C: p.C
                  }

                  proofsToExport.push(proofToExport)
                }

                const tokenByKeysetId: TokenV3 = {
                  token: [
                      {
                          mint,
                          proofs: proofsToExport
                      }
                  ],
                  unit: proofsByKeysetId[0].unit
                }
                
                log.trace('[copyEncodedTokens]', {tokenByKeysetId})

                const encodedByMint = CashuUtils.encodeToken(tokenByKeysetId)
                encodedTokens.push(encodedByMint)                
              }
            }                       
            
            Clipboard.setString(JSON.stringify(encodedTokens))
            setIsLoading(false)

        } catch (e: any) {
            handleError(e)
            // setInfo(translate('common.copyFailParam', { param: e.message }))
        }
    }


    /* const onRecovery = async function () {
      if (!showUnspentOnly) {
        setInfo(translate("unspentOnlyRecoverable"))
        return
      }

      const balances = proofsStore.getBalances()
      let message: string = ''

      const nonZeroBalances = balances.mintBalances.filter(b => Object.values(b.balances).some(b => b && b > 0))        
      
      log.trace('[onRecovery]', {nonZeroBalances})

      if (nonZeroBalances && nonZeroBalances.length > 0) {
          message = translate("backupWillOverwriteBalanceWarning")
          message += "\n\n"
      }

      message += translate("confirmBackupRecovery")

      Alert.alert(
        translate("attention"),
        message,
        [
          {
            text: translate('common.cancel'),
            style: 'cancel',
            onPress: () => {
              // Action canceled
            },
          },
          {
            text: translate("startRecovery"),
            onPress: () => {
              try {
                doLocalRecovery()
              } catch (e: any) {
                handleError(e)
              }
            },
          },
        ],
      )
    }


    const doLocalRecovery = async function () {
      try {
        if(!showUnspentOnly) {
          setInfo(translate('unspentOnlyRecoverable'))
          return
        }

        if(mintsStore.allMints.length === 0) {
          setInfo(translate('missingMintsForProofsUserMessage'))
        }
        
        setIsLoading(true)

        const groupedByMint = groupProofsByMint(proofs)
        await transactionsStore.expireAllAfterRecovery()

          for (const mint in groupedByMint) { 
            
            const proofsByMint = groupedByMint[mint]

            if(proofsByMint.length === 0) {
              continue
            }

            proofsStore.removeOnLocalRecovery(proofsByMint, false)

            const groupedByKeyset = groupProofsByKeysets(proofsByMint)

            for (const keysetId in groupedByKeyset) {
              const proofsByKeysetId = groupedByKeyset[keysetId]
              const proofsToImport: ProofV3[] = []

              for (const proof of proofsByKeysetId) {
                const { tId, unit, isPending, isSpent, updatedAt, ...proofToImport } = proof
                proofsToImport.push(proofToImport)
              }

              if(proofsToImport.length === 0) {
                continue
              }

              const amount = CashuUtils.getProofsAmount(proofsToImport)
              const unit = proofsByKeysetId[0].unit

              log.trace('[doLocalRecovery] to be recovered', {mint, keysetId, unit, amount})

              let transactionData: TransactionData[] = []              

              transactionData.push({
                status: TransactionStatus.PREPARED,
                amount,
                createdAt: new Date(),
              })

              const newTransaction = {
                type: TransactionType.RECEIVE,
                amount,
                fee: 0,
                unit: unit as MintUnit,
                data: JSON.stringify(transactionData),
                memo: 'Recovery from backup',
                mint: mint,
                status: TransactionStatus.PREPARED,
              }

              const transaction = await transactionsStore.addTransaction(newTransaction)              

              const { amountToAdd, addedAmount } = WalletUtils.addCashuProofs(
                  mint,
                  proofsToImport,
                  {
                      unit: unit as MintUnit,
                      transactionId: transaction.id,
                      isPending: false
                  }            
              )                 

              if (amountToAdd !== addedAmount) {
                  transaction.setReceivedAmount(addedAmount)                       
              }

              const balanceAfter = proofsStore.getUnitBalance(unit as MintUnit)?.unitBalance || 0
              transaction.setBalanceAfter(balanceAfter)

              // Finally, update completed transaction
              transactionData.push({
                  status: TransactionStatus.COMPLETED,
                  addedAmount,                       
                  createdAt: new Date(),
              })

              transaction.setStatus(                  
                  TransactionStatus.COMPLETED,
                  JSON.stringify(transactionData),
              )               
            }
          }

          setIsLoading(false)

      } catch (e: any) {
          handleError(e)
      }
  } */


    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }

    
    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const activeIconColor = useThemeColor('tint')
    const headerTitle = useThemeColor('headerTitle')


  return (
      <Screen style={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="heading"
            tx="exportBackup"
            style={{color: headerTitle}}
          />
        </View>
        <View style={$contentContainer}>
            <Card
              ContentComponent={
                <>
                {proofsStore.proofsCount + proofsStore.pendingProofsCount > 0 && (
                    <ListItem
                        text="Backup ecash"
                        subText={`Number of proofs: ${proofsStore.proofsCount + proofsStore.pendingProofsCount}`}
                        RightComponent={
                        <View style={$rightContainer}>
                        <Switch
                            onValueChange={toggleBackupEcashSwitch}
                            value={isEcashInBackup}
                        />
                        </View>
                    }
                        // textStyle={{marginLeft: spacing.extraSmall}}  
                        topSeparator                       
                    />
                )}
                {mintsStore.mintCount > 0 && (
                    <ListItem
                    text="Backup mints"
                    subText={`Number of mints: ${mintsStore.mintCount}`}
                    RightComponent={
                    <View style={$rightContainer}>
                    <Switch
                        onValueChange={toggleBackupMintsSwitch}
                        value={isMintsInBackup}
                    />
                    </View>
                    }
                    // textStyle={{marginLeft: spacing.extraSmall}}  
                    topSeparator                       
                    />
                )}  
                {contactsStore.count > 0 && (
                    <ListItem
                    text="Backup contacts"
                    subText={`Number of contacts: ${contactsStore.count}`}
                    RightComponent={
                        <View style={$rightContainer}>
                        <Switch
                            onValueChange={toggleBackupContanctsSwitch}
                            value={isContactsInBackup}
                        />
                        </View>
                    }
                    // textStyle={{marginLeft: spacing.extraSmall}}  
                    topSeparator                       
                    />
                )}
                {contactsStore.count > 0 && (
                    <ListItem
                    text="Backup recent transactions"
                    subText={`Number of transactions: ${transactionsStore.count}`}
                    RightComponent={
                        <View style={$rightContainer}>
                        <Switch
                            onValueChange={toggleBackupTransactionsSwitch}
                            value={isTransactionsInBackup}
                        />
                        </View>
                    }
                    // textStyle={{marginLeft: spacing.extraSmall}}  
                    topSeparator                       
                    />
                )}
                {/*Object.values(MintUnits).map(unit => 
                  proofs.some(p => p.unit === unit) && (
                    <ListItem
                      key={unit}
                      text={getCurrency(unit).code}
                      textStyle={{marginLeft: spacing.extraSmall}}
                      RightComponent={
                        <CurrencyAmount 
                          amount={CashuUtils.getProofsAmount(proofs.filter(p => p.unit === unit))} 
                          mintUnit={unit}
                          containerStyle={{marginRight: spacing.extraSmall}} 
                        />
                      }                            
                    />
                ))*/}
                </>
              }
              style={[$card]}
            />
          
          <View style={$bottomContainer}>
            <View style={$buttonContainer}>
                <Button                  
                    onPress={copyBackup}
                    text="Copy backup"
                    style={{                  
                        marginRight: spacing.small                           
                    }}                  
                />
            </View>
            {proofsStore.proofsCount > 0 && (
                <View style={$buttonContainer}>
                    <Button
                        preset="tertiary"
                        onPress={copyEncodedTokens}
                        tx="copyAsEncodedTokens"                  
                        textStyle={{fontSize: 14}}
                    />
                </View>
            )}            
          </View>        
          {isLoading && <Loading />}
          {error && <ErrorModal error={error} />}
          {info && <InfoModal message={info} />}
        </View>
      </Screen>
    )
  }

const $screen: ViewStyle = {
  // borderWidth: 1,
  // borderColor: 'red'
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.10,
}

const $contentContainer: TextStyle = {
  // minHeight: spacing.screenHeight * 0.5,
  padding: spacing.extraSmall,
}

const $actionCard: ViewStyle = {
  marginBottom: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 2,
  paddingTop: 0,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
}

const $cardHeading: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: 20,
}

const $iconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  // alignSelf: 'center',
  marginLeft: spacing.tiny,
  marginRight: -10
}

const $bottomContainer: ViewStyle = { 
  marginBottom: spacing.medium,
  
}
