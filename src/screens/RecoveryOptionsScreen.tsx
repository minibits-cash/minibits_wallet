import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback, useEffect} from 'react'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import {spacing, useThemeColor, colors} from '../theme'
import {AppStackScreenProps, SettingsStackScreenProps, WalletStackScreenProps} from '../navigation'
import {
  Button,
  Icon,
  Card,
  Screen,
  ListItem,
  Text,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError from '../utils/AppError'
import { useStores } from '../models'
import { SyncStateTaskResult, WalletTask } from '../services/walletService'
import EventEmitter from '../utils/eventEmitter'
import { translate } from '../i18n'

export enum RecoveryOption {
    SEND_TOKEN = 'SEND_TOKEN',
    PASTE_OR_SCAN_INVOICE = 'PASTE_OR_SCAN_INVOICE',
    SHOW_TOKEN = 'SHOW_TOKEN',
    PAY_PAYMENT_REQUEST = 'PAY_PAYMENT_REQUEST',
    LNURL_PAY = 'LNURL_PAY',
    LNURL_ADDRESS = 'LNURL_ADDRESS',
    DONATION = 'DONATION',
}

export const RecoveryOptionsScreen: FC<AppStackScreenProps<'RecoveryOptions'>> = observer(
  function RecoveryOptionsScreen({route, navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    }) 
    
    const {mintsStore} = useStores()
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')
    const [isSyncStateSentToQueue, setIsSyncStateSentToQueue] = useState<boolean>(false)    
    const [totalSpentAmount, setTotalSpentAmount] = useState<number>(0)   


    useEffect(() => {
      const removeSpentByMintTaskResult = async (result: SyncStateTaskResult) => {
          log.trace('[removeSpentByMintTaskResult] event handler triggered')

          if (!isSyncStateSentToQueue) { return false }
          
          setIsLoading(false)            

          // runs per each mint
          if (result && result.transactionStateUpdates.length > 0) {

              log.trace('[removeSpentByMintTaskResult]', {transactionStateUpdates: result.transactionStateUpdates})

              let totalSpentPerMint = 0

              for (const update of result.transactionStateUpdates) {                    
                  if(update.spentByMintAmount) {
                    totalSpentPerMint += update.spentByMintAmount
                  }                
              }

              setTotalSpentAmount(prev => prev + totalSpentPerMint)
          }       
      }
      
      if(isSyncStateSentToQueue) {
        EventEmitter.on('ev__syncStateWithMintTask_result', removeSpentByMintTaskResult)
      }
      
      return () => {
          EventEmitter.off('ev__syncStateWithMintTask_result', removeSpentByMintTaskResult)            
      }
  }, [isSyncStateSentToQueue])



  useEffect(() => {
    const showSpentEcashResult = () => {
        log.trace('[showSpentEcashResult] got update', {totalSpentAmount})

        if (totalSpentAmount === 0) { return false }

        setInfo(`Removed spent ecash with amount ${totalSpentAmount}.`)                
    }
    
    showSpentEcashResult()

  }, [totalSpentAmount])

    const gotoSeedRecovery = function () {
        navigation.navigate('SeedRecovery')
    }


    const gotoImportBackup = function () {
        navigation.navigate('ImportBackup', {isAddressOnlyRecovery: false})
    }


    const gotoAddressRecovery = function () {
      navigation.navigate('ImportBackup', {isAddressOnlyRecovery: true})
  }


    const checkSpent = async function () {
      setIsLoading(true)
      setIsSyncStateSentToQueue(true)
      WalletTask.syncSpendableStateWithMints()      
    }


    const increaseCounters = async function () {
      const increaseAmount = 50
      for (const mint of mintsStore.allMints) {
        for(const counter of mint.proofsCounters) {
          counter.increaseProofsCounter(increaseAmount)
        }            
      }  
      setInfo(translate("recoveryIndexesIncSuccess", { indCount: increaseAmount }))
    }

    const handleError = function (e: AppError): void {
      log.error(e.name, e.message)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const subtitleColor = useThemeColor('textDim')

    return (
      <Screen preset="scroll" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <Text
              preset="heading"
              tx="recoveryOptions.title"
              style={{color: 'white'}}
            />
        </View>
        <View style={$contentContainer}>  
        {route.params && route.params.fromScreen !== 'Settings' && (                
            <Card
                style={$ecashCard}
                ContentComponent={
                    <>
                    <ListItem
                        tx="recoveryOptions.fromBackup"
                        subTx="recoveryOptions.fromBackupDescription"
                        leftIcon='faDownload'
                        leftIconColor={colors.palette.focus300}
                        leftIconInverse={true}
                        style={$item}
                        bottomSeparator={true}
                        onPress={gotoImportBackup}
                    />                 
                    <ListItem
                        tx="recoveryOptions.fromSeed"
                        subTx="recoveryOptions.fromSeedDescription"
                        leftIcon='faSeedling'
                        leftIconColor={colors.palette.orange400}
                        leftIconInverse={true}                        
                        style={$item}
                        onPress={gotoSeedRecovery}
                    />   
                    </>
              }
            />
          )}
          {route.params && route.params.fromScreen === 'Settings' && (
            <>
              <Card
                style={$card}
                HeadingComponent={
                <ListItem
                  tx="walletAddressRecovery"
                  subTx="walletAddressRecoveryDesc"
                  leftIcon='faCircleUser'
                  leftIconColor={colors.palette.iconViolet300}
                  leftIconInverse={true}
                  style={$item}
                  onPress={gotoAddressRecovery}
                />}
              />
              <Card
                style={$card}
                HeadingComponent={                               
                  <ListItem
                      tx="backupScreen.removeSpentCoins"
                      subTx="backupScreen.removeSpentCoinsDescription"
                      leftIcon='faRecycle'
                      leftIconColor={colors.palette.secondary300}
                      leftIconInverse={true}
                      RightComponent={
                        <View style={$rightContainer}>
                            <Button
                              onPress={checkSpent}
                              text='Remove'
                              preset='secondary'                                           
                            /> 
                        </View>                           
                      }
                      style={$item}                        
                  />
                }
              /> 
              <Card
                  style={$card}
                  HeadingComponent={
                  <>                
                      <ListItem
                          tx="increaseRecoveryIndexes"
                          subTx="increaseRecoveryIndexesDesc"
                          leftIcon='faArrowUp'
                          leftIconColor={colors.palette.success300}
                          leftIconInverse={true}
                          RightComponent={
                              <View style={$rightContainer}>
                                  <Button
                                      onPress={increaseCounters}
                                      text='Increase'
                                      preset='secondary'                                           
                                  /> 
                              </View>                           
                          } 
                          style={$item}                        
                      />
                  </>
                  }
              />
              </>
            )}
            
        </View>
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  // flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $ecashCard: ViewStyle = {
  // marginTop: -spacing.extraLarge * 1.5,
  marginBottom: spacing.small,
  // paddingTop: 0,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $rightContainer: ViewStyle = {
  // padding: spacing.extraSmall,
  // alignSelf: 'center',
  marginLeft: spacing.tiny,
  marginRight: -10
}

const $lightningCard: ViewStyle = {
    marginVertical: spacing.small,    
    // paddingTop: 0,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}
