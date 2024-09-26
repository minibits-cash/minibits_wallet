import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  useColorScheme,
  Alert,
} from 'react-native'
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
import {BackupProof} from '../models/Proof'
import { useStores } from '../models'
import { CashuUtils, ProofV3, TokenV3 } from '../services/cashu/cashuUtils'
import Clipboard from '@react-native-clipboard/clipboard'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../models/Transaction'
import { WalletUtils } from '../services/wallet/utils'
import { MintUnit, MintUnits, getCurrency } from '../services/wallet/currency'
import { CurrencyAmount } from './Wallet/CurrencyAmount'
import { translate } from '../i18n'

interface LocalRecoveryScreenProps
  extends SettingsStackScreenProps<'LocalRecovery'> {}


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
            await Database.updateProofsToDefaultUnit()
            const backupProofs = await Database.getProofs(isUnspent, isPending, isDeleted)
            setProofs(backupProofs)
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

            const groupedByMint = groupProofsByMint(proofs)

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
  }

  const groupProofsByMint = function (proofs: BackupProof[]) {
    return proofs.reduce((acc: Record<string, BackupProof[]>, proof) => {
      
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

  const groupProofsByKeysets = function (proofsByMint: BackupProof[]) {
    return proofsByMint.reduce((acc: Record<string, BackupProof[]>, proof) => {
      // Check if there's already an array for this keyset, if not, create one
      if (!acc[proof.id as string]) {
        acc[proof.id] = []
      }                 
      
      // Push the object into the array corresponding to its keyset
      acc[proof.id].push(proof)
      return acc;
    }, {})
  }





    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }

    
    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const activeIconColor = useThemeColor('button')
    const headerTitle = useThemeColor('headerTitle')


  return (
      <Screen style={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="heading"
            tx="recoveryTool"
            style={{color: headerTitle}}
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
