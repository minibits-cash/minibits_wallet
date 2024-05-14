import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  useColorScheme,
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
import { MintUnit } from '../services/wallet/currency'
import { ScrollView } from 'react-native-gesture-handler'
import { CurrencyAmount } from './Wallet/CurrencyAmount'

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

            if(mintsStore.allMints.length === 0) {
              setInfo('Please add all mints your proofs belong to the wallet. Then try again.')
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
            setInfo(`Could not copy: ${e.message}`)
        }
    }


    const recoverProofs = async function () {
      try {
          if(proofsStore.proofsCount > 0) {
            setInfo('Your wallet contains unspent ecash, recovery is not safe.')
            return
          }

          if(showSpentOnly) {
            setInfo('Can not recover proofs that were already spent.')
            return
          }

          if(mintsStore.allMints.length === 0) {
            setInfo('Please add all mints your proofs belong to the wallet. Then try again.')
          }
        
          setIsLoading(true)
          
          for (const mint of mintsStore.allMints) {
              
              let proofsByMint: CashuProof[] = []
              let transactionData: TransactionData[] = []                

              for (const proof of proofs) {

                  const proofMint = CashuUtils.getMintFromProof(proof, mintsStore.allMints)                    
                  
                  const { tId, isPending, isSpent, updatedAt, ...cleanedProof } = proof

                  if (!proofMint) { continue }                

                  if(mint.mintUrl === proofMint.mintUrl) {                        
                      proofsByMint.push(cleanedProof)
                  }                    
              }

              if (proofsByMint.length > 0) {

                const groupedByUnit: Record<string, Proof[]> = proofsByMint.reduce((acc, proof) => {
                  // Check if there's already an array for this unit, if not, create one
                  if (!acc[proof.unit]) {
                    acc[proof.unit] = []
                  }
                  // Push the object into the array corresponding to its unit
                  acc[proof.unit].push(proof)
                  return acc;
                }, {})

                //log.trace('[groupedByMint]', groupedByUnit)

                for (const unit in groupedByUnit) {

                  if (Object.prototype.hasOwnProperty.call(groupedByUnit, unit)) {
                    const proofsToAdd = groupedByUnit[unit]
                    const amount = CashuUtils.getProofsAmount(proofsToAdd as Proof[])

                    log.trace({mint: mint.mintUrl, unit, amount})

                    transactionData.push({
                      status: TransactionStatus.PREPARED,
                      amount,
                      createdAt: new Date(),
                    })

                    const newTransaction: Transaction = {
                      type: TransactionType.RECEIVE,
                      amount,
                      fee: 0,
                      unit: unit as MintUnit,
                      data: JSON.stringify(transactionData),
                      memo: 'Wallet recovery from backup',
                      mint: mint.mintUrl,
                      status: TransactionStatus.PREPARED,
                    }


                    const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
                    const transactionId = draftTransaction.id as number
      
                    const { amountToAdd, addedAmount } = WalletUtils.addCashuProofs(
                        mint.mintUrl,
                        proofsToAdd,
                        {
                            unit: unit as MintUnit,
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
          setInfo(`Could not copy: ${e.message}`)
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
            text="Recovery tool"
            style={{color: 'white'}}
          />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$actionCard}
            ContentComponent={
              <>
                <ListItem
                  text={'Unspent'}
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
                  text={'Pending'}
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
                  text={'Spent'}
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
                  text={'Number of proofs'}
                  RightComponent={
                    <Text text={`${proofs.length}`} />
                  }                            
                />
                {proofs.some(p => p.unit === 'sat') && (
                  <ListItem
                    text={'SAT'}
                    RightComponent={
                      <CurrencyAmount 
                        amount={CashuUtils.getProofsAmount(proofs.filter(p => p.unit === 'sat'))} 
                        mintUnit='sat'  
                      />
                    }                            
                  />
                )}
                {proofs.some(p => p.unit === 'msat') && (
                  <ListItem
                    text={'mSAT'}
                    RightComponent={
                      <CurrencyAmount 
                        amount={CashuUtils.getProofsAmount(proofs.filter(p => p.unit === 'msat'))} 
                        mintUnit='msat'  
                      />
                    }                            
                  />
                )}
                {proofs.some(p => p.unit === 'btc') && (
                  <ListItem
                    text={'BTC'}
                    RightComponent={
                      <CurrencyAmount 
                        amount={CashuUtils.getProofsAmount(proofs.filter(p => p.unit === 'btc'))} 
                        mintUnit='btc'  
                      />
                    }                            
                  />
                )}
                {proofs.some(p => p.unit === 'usd') && (
                  <ListItem
                    text={'USD'}
                    RightComponent={
                      <CurrencyAmount 
                        amount={CashuUtils.getProofsAmount(proofs.filter(p => p.unit === 'usd'))} 
                        mintUnit='usd'  
                      />
                    }                            
                  />
                )}
                {proofs.some(p => p.unit === 'eur') && (
                  <ListItem
                    text={'EUR'}
                    RightComponent={
                      <CurrencyAmount 
                        amount={CashuUtils.getProofsAmount(proofs.filter(p => p.unit === 'eur'))} 
                        mintUnit='eur'  
                      />
                    }                            
                  />
                )}
             
                </>
              }
              FooterComponent={
                <View style={$buttonContainer}>
                    <Button
                        preset="tertiary"
                        onPress={copyBackupProofs}
                        text="Copy proofs"
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
                        text="Copy as encoded tokens"
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
                onPress={recoverProofs}
                text={`Recover to wallet`}
              />  
            </View>  
          </View>          
          {isLoading && <Loading />}
        </View>
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
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
  minHeight: spacing.screenHeight * 0.5,
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
