import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  useColorScheme,
  Alert,
} from 'react-native'
import {
    type Proof as CashuProof,
} from '@cashu/cashu-ts'
import {useThemeColor, spacing, colors, typography} from '../theme'
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
import {Database} from '../services'
import AppError from '../utils/AppError'
import {BackupProof, Proof} from '../models/Proof'
import { useStores } from '../models'
import { CashuUtils } from '../services/cashu/cashuUtils'
import JSONTree from 'react-native-json-tree'
import Clipboard from '@react-native-clipboard/clipboard'
import { getEncodedToken } from '@cashu/cashu-ts'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../models/Transaction'
import { WalletUtils } from '../services/wallet/utils'
import { MintUnit, MintUnits, getCurrency } from '../services/wallet/currency'
import { ScrollView } from 'react-native-gesture-handler'
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { translate } from '../i18n'

interface LocalRecoveryScreenProps
  extends SettingsStackScreenProps<'LocalRecovery'> {}

// Number of transactions held in TransactionsStore model
const limit = 10

export const LocalRecoveryScreen: FC<LocalRecoveryScreenProps> =
  function LocalRecoveryScreen(_props) {

  const { navigation } = _props
  const { mintsStore, proofsStore, transactionsStore } = useStores()

  useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })


    const [showUnspentOnly, setShowUnspentOnly] = useState<boolean>(true)
    const [showPendingOnly, setShowPendingOnly] = useState<boolean>(false)
    const [showSpentOnly, setShowSpentOnly] = useState<boolean>(false)
    const [proofs, setProofs] = useState<BackupProof[]>([])
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    
    useEffect(() => {
      getProofsList(true, false, false)
      // Run on component unmount (cleanup)
      return () => {}
    }, [])

    const getProofsList = async function (
        isUnspent: boolean,
        isPending: boolean,
        isDeleted: boolean,
    ) {
      try {
            setIsLoading(true)
            // update empty unit fields to resolve v0.1.7 upgrade issue of backed up proofs not having unit migrated
            const update = await Database.updateProofsToDefaultUnit()
            const proofs = await Database.getProofs(isUnspent, isPending, isDeleted)           

            setProofs(proofs)
            setIsLoading(false)
           
      } catch (e: any) {
        handleError(e)
      }
    }

    const toggleShowUnspentOnly = () =>
        setShowUnspentOnly(previousState => {
            if (!previousState) { // if on
                getProofsList(true, false, false)
                setShowSpentOnly(false)
                setShowPendingOnly(false)
            }

            return !previousState
    })
    
    const toggleShowPendingOnly = () =>
        setShowPendingOnly(previousState => {
            if (!previousState) { // if on
                getProofsList(false, true, false)
                setShowUnspentOnly(false)
                setShowSpentOnly(false)
            }
    
            return !previousState
    })

    const toggleShowSpentOnly = async () =>
        setShowSpentOnly(previousState => {
            if (!previousState) { // if on
                getProofsList(false, false, true)
                setShowUnspentOnly(false)
                setShowPendingOnly(false)
            }
    
            return !previousState
    })


    const copyBackupProofs = function () {
        try {               
            Clipboard.setString(JSON.stringify(proofs))  
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
        }
    }


    const copyEncodedTokens = function () {
        try {
            setIsLoading(true)
            const encodedTokens: string[] = []

            if (mintsStore.allMints.length === 0) {
              setInfo(translate("missingMintsForProofsUserMessage"))
            }

            for (const mint of mintsStore.allMints) {
                
                let proofsByMint: CashuProof[] = []                

                for (const proof of proofs) {

                    const proofMint = CashuUtils.getMintFromProof(proof, mintsStore.allMints)                    
                    
                    const { tId, unit, isPending, isSpent, updatedAt, ...cleanedProof } = proof

                    if (!proofMint) { continue }                

                    if(mint.mintUrl === proofMint.mintUrl) {                        
                        proofsByMint.push(cleanedProof)
                    }                    
                }

                if (proofsByMint.length > 0) {
                    const tokenByMint = {
                        token: [
                            {
                                mint: mint.mintUrl,
                                proofs: proofsByMint
                            }
                        ]
                    }

                    log.trace(tokenByMint)

                    const encodedByMint = getEncodedToken(tokenByMint)
                    encodedTokens.push(encodedByMint)
                }
            }            
            
            Clipboard.setString(JSON.stringify(encodedTokens))
            setIsLoading(false)

        } catch (e: any) {
            setInfo(translate('common.copyFailParam', { param: e.message }))
        }
    }


    const onRecovery = async function () {
      if (!showUnspentOnly) {
        setInfo(translate("unspentOnlyRecoverable"))
        return
      }

      const balances = proofsStore.getBalances()
      let message: string = ''

      const nonZeroBalances = balances.mintBalances.filter(b => Object.values(b.balances).some(b => b && b > 0))        
      
      log.trace('[onRecovery]', nonZeroBalances)

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
          
          for (const mint of mintsStore.allMints) {
              
              let proofsByMint: Proof[] = []
              let transactionData: TransactionData[] = []                

              for (const proof of proofs) {
                const proofMint = CashuUtils.getMintFromProof(proof, mintsStore.allMints)                    
                const { isPending, isSpent, updatedAt, ...cleanedProof } = proof

                if (!proofMint) { continue }                

                if (mint.mintUrl === proofMint.mintUrl) {                        
                  proofsByMint.push(cleanedProof)
                }                    
              }

              if (proofsByMint.length > 0) {

                // delete from wallet storage
                proofsStore.removeOnLocalRecovery(proofsByMint, false)
                await transactionsStore.expireAllAfterRecovery()

                const groupedByKeyset = proofsByMint.reduce((acc: Record<string, Proof[]>, proof) => {
                  // Check if there's already an array for this keyset, if not, create one
                  if (!acc[proof.id as string]) {
                    acc[proof.id] = []
                  }
                  // Push the object into the array corresponding to its keyset
                  acc[proof.id].push(proof)
                  return acc;
                }, {})

                for (const keysetId in groupedByKeyset) {                  

                  if (Object.prototype.hasOwnProperty.call(groupedByKeyset, keysetId)) {
                    const proofsToAdd = groupedByKeyset[keysetId]
                    const unit = proofsToAdd[0].unit
                    const amount = CashuUtils.getProofsAmount(proofsToAdd as Proof[])

                    log.trace({mint: mint.mintUrl, keysetId, amount})

                    transactionData.push({
                      status: TransactionStatus.PREPARED,
                      amount,
                      createdAt: new Date(),
                    })

                    const newTransaction: Transaction = {
                      type: TransactionType.RECEIVE,
                      amount,
                      fee: 0,
                      unit,
                      data: JSON.stringify(transactionData),
                      memo: 'Recovery from backup',
                      mint: mint.mintUrl,
                      status: TransactionStatus.PREPARED,
                    }

                    const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
                    const transactionId = draftTransaction.id as number
      
                    const { amountToAdd, addedAmount } = WalletUtils.addCashuProofs(
                        mint.mintUrl,
                        proofsToAdd,
                        {
                            unit,
                            transactionId,
                            isPending: false
                        }            
                    )                 
      
                    if (amountToAdd !== addedAmount) {
                        await transactionsStore.updateReceivedAmount(
                            transactionId as number,
                            addedAmount,
                        )                       
                    }

                    const balanceAfter = proofsStore.getUnitBalance(unit)?.unitBalance || 0
                    await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)
      
                    // Finally, update completed transaction
                    transactionData.push({
                        status: TransactionStatus.COMPLETED,
                        addedAmount,                       
                        createdAt: new Date(),
                    })
      
                    await transactionsStore.updateStatus(
                        transactionId,
                        TransactionStatus.COMPLETED,
                        JSON.stringify(transactionData),
                    )
                  }
                }
              }
          }

          setIsLoading(false)

      } catch (e: any) {
          handleError(e)
      }
  }


    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }

    const colorScheme = useColorScheme()
    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const dateColor = useThemeColor('textDim')
    const iconSelectedColor = useThemeColor('button')
    const activeIconColor = useThemeColor('button')
    const hintColor = colors.palette.primary200


  return (
      <Screen style={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="heading"
            tx="recoveryTool"
            style={{color: 'white'}}
          />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$actionCard}
            ContentComponent={
              <>
                <ListItem
                  tx="transactionCommon.status.unspent"
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon="faCoins"
                      size={spacing.medium}
                      color={showUnspentOnly ? activeIconColor : iconColor}
                    />
                  }
                  style={$item}
                  onPress={toggleShowUnspentOnly}
                  // bottomSeparator={true}
                />
                <ListItem
                  tx="transactionCommon.status.pending"
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon="faPaperPlane"
                      size={spacing.medium}
                      color={showPendingOnly ? activeIconColor : iconColor}
                    />
                  }
                  style={$item}
                  onPress={toggleShowPendingOnly}
                  // bottomSeparator={true}
                />
                <ListItem
                  tx="transactionCommon.status.spent"
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon="faBan"
                      size={spacing.medium}
                      color={showSpentOnly ? activeIconColor : iconColor}
                    />
                  }
                  style={$item}
                  onPress={toggleShowSpentOnly}
                />
              </>
            }
          />
          {proofs && (
            <Card
              ContentComponent={
                <>
                <ListItem
                  tx="numberOfBackedupProofs"
                  RightComponent={
                    <Text text={`${proofs.length}`} style={{marginRight: spacing.small}} />
                  }   
                  textStyle={{marginLeft: spacing.extraSmall}}  
                  bottomSeparator                       
                />
                {Object.values(MintUnits).map(unit => 
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
                ))}
                </>
              }
              FooterComponent={
                <View style={$buttonContainer}>
                    <Button
                        preset="tertiary"
                        onPress={copyBackupProofs}
                        tx="copyProofs"
                        style={{
                            minHeight: 25,
                            paddingVertical: spacing.extraSmall,
                            marginTop: spacing.small,
                            marginRight: spacing.small                           
                        }}
                        textStyle={{fontSize: 14}}
                    />
                    <Button
                        preset="tertiary"
                        onPress={copyEncodedTokens}
                        tx="copyAsEncodedTokens"
                        style={{
                            minHeight: 25,
                            paddingVertical: spacing.extraSmall,
                            marginTop: spacing.small,                            
                        }}
                        textStyle={{fontSize: 14}}
                    />
                </View>  
              }
              style={[$card]}
            />
          )}
          <View style={$bottomContainer}>
            <View style={$buttonContainer}>
              <Button 
                onPress={onRecovery}
                tx="recoverToWallet"
              />  
            </View>  
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
  height: spacing.screenHeight * 0.20,
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



const $bottomContainer: ViewStyle = { 
  marginBottom: spacing.medium,
  
}
