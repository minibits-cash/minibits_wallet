import {observer} from 'mobx-react-lite'
import React, {useState, useEffect, useRef} from 'react'
import {Platform, ScrollView, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import notifee, { AndroidImportance } from '@notifee/react-native'
import {spacing, useThemeColor, colors} from '../theme'
import {
  Button,  
  Card,
  Screen,
  ListItem,
  Text,
  ErrorModal,
  InfoModal,
  Loading,
  BottomModal,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'
import { useStores } from '../models'
import { SYNC_STATE_WITH_ALL_MINTS_TASK, SyncStateTaskResult, WalletTask } from '../services/walletService'
import EventEmitter from '../utils/eventEmitter'
import { translate } from '../i18n'
import { NotificationService } from '../services/notificationService'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { MintBalanceSelector } from './Mints/MintBalanceSelector'
import { MintBalance } from '../models/Mint'
import { MintUnit } from '../services/wallet/currency'
import Clipboard from '@react-native-clipboard/clipboard'

type Props = StaticScreenProps<{
  fromScreen?: string
}>

export const RecoveryOptionsScreen = observer(function RecoveryOptionsScreen({ route }: Props) {
    const navigation = useNavigation()
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })
    
    const {mintsStore, proofsStore} = useStores()

    const unitRef = useRef<MintUnit>('sat')
    const mintBalancesRef = useRef<MintBalance[]>(proofsStore.getMintBalancesWithUnit('sat'))
    const mintQuoteInputRef = useRef<TextInput>(null)

    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')    
    const [mintBalanceToRecoverFrom, setMintBalanceToRecoverFrom] = useState<MintBalance>(mintBalancesRef.current[0])
    const [mintQuote, setMintQuote] = useState<string>('')
    const [meltQuote, setMeltQuote] = useState<string>('')
    const [mintedAmount, setMintedAmount] = useState<number>(0)
    const [meltChangeAmount, setMeltChangeAmount] = useState<number>(0)
    const [isSyncStateSentToQueue, setIsSyncStateSentToQueue] = useState<boolean>(false)
    const [isNotificationModalVisible, setIsNotificationModalVisible] = useState(false)
    const [isMintQuoteRecoveryStarted, setIsMintQuoteRecoveryStarted] = useState(false)
    const [isMeltQuoteRecoveryStarted, setIsMeltQuoteRecoveryStarted] = useState(false)
    const [isMintSelectorModalVisible, setIsMintSelectorModalVisible] = useState(false)
    const [isMintQuoteModalVisible, setIsMintQuoteModalVisible] = useState(false)
    const [isMeltQuoteModalVisible, setIsMeltQuoteModalVisible] = useState(false) 
    const [isMintQuoteResultModalVisible, setIsMintQuoteResultModalVisible] = useState(false)
    const [isMeltQuoteResultModalVisible, setIsMeltQuoteResultModalVisible] = useState(false) 


    useEffect(() => {
      const removeSpentByMintTaskResult = async (result: SyncStateTaskResult) => {
          log.trace('[removeSpentByMintTaskResult] event handler triggered')

          if (!isSyncStateSentToQueue) { return false }
          
          setIsLoading(false)            
          setInfo(result.message)
      }
      
      if(isSyncStateSentToQueue) {
        EventEmitter.on(`ev_${SYNC_STATE_WITH_ALL_MINTS_TASK}_result`, removeSpentByMintTaskResult)
      }
      
      return () => {        
        EventEmitter.off(`ev_${SYNC_STATE_WITH_ALL_MINTS_TASK}_result`, removeSpentByMintTaskResult)
      }
  }, [isSyncStateSentToQueue])

    const openNotificationSettings = async function() {
      if(Platform.OS === 'android') {
        await notifee.openNotificationSettings()        
      } else {
        const settings  = await notifee.requestPermission()
      }
    }


    const toggleNotificationModal = () =>
      setIsNotificationModalVisible(previousState => !previousState)
  

    const toggleMintSelectorModal = () => {
      setIsMintSelectorModalVisible(previousState => !previousState)
    }     


    const toggleMintQuoteModal = () =>
      setIsMintQuoteModalVisible(previousState => !previousState)


    const toggleMeltQuoteModal = () =>
      setIsMeltQuoteModalVisible(previousState => !previousState)


    const toggleMintQuoteResultModal = () =>
      setIsMintQuoteResultModalVisible(previousState => !previousState)

    const toggleMeltQuoteResultModal = () =>
      setIsMeltQuoteResultModalVisible(previousState => !previousState)

    const gotoSeedRecovery = function () {
      //@ts-ignore
      navigation.navigate('SeedRecovery')
    }


    const gotoImportBackup = function () {
      //@ts-ignore
      navigation.navigate('ImportBackup')
    }


    const gotoAddressRecovery = function () {
      //@ts-ignore
      navigation.navigate('RecoverWalletAddress')
    }


    const checkSpent = async function () {
      const enabled = await NotificationService.areNotificationsEnabled()

      if(!enabled) {
        toggleNotificationModal()
        return
      }
      
      setIsLoading(true)
      setIsSyncStateSentToQueue(true)

      if(Platform.OS === 'android') {
        await NotificationService.createForegroundNotification(
          'Cleaning spent ecash from spendable balance...',
          {task: SYNC_STATE_WITH_ALL_MINTS_TASK}
        )
      } else {
        // iOS does not support fg notifications with long running tasks
        WalletTask.syncStateWithAllMintsQueue({isPending: false})        
      }      
    }


    const increaseCounters = async function () {
      const increaseAmount = 20
      for (const mint of mintsStore.allMints) {
        for(const counter of mint.proofsCounters) {
          counter.increaseProofsCounter(increaseAmount)
        }            
      }  
      setInfo(translate("recoveryIndexesIncSuccess", { indCount: increaseAmount }))
    }

    const onMintBalanceSelect = function (balance: MintBalance) {
      setMintBalanceToRecoverFrom(balance)
    }

    const onMintBalanceConfirm = function () {      
      toggleMintSelectorModal()

      if(setMintBalanceToRecoverFrom) {
        if(Platform.OS === 'ios') {
          setTimeout(() => {
            if(isMeltQuoteRecoveryStarted) {
              toggleMeltQuoteModal()
            }
            if(isMintQuoteRecoveryStarted) {
              toggleMintQuoteModal()
            }
            
          }, 500)
        } else {
          if(isMeltQuoteRecoveryStarted) {
            toggleMeltQuoteModal()
          }
          if(isMintQuoteRecoveryStarted) {
            toggleMintQuoteModal()
          }
        }
      }      
    }

    const onMintBalanceCancel = async function () {
      toggleMintSelectorModal()      
    }

    const onPasteMintQuote = async function () {
      const quote = await Clipboard.getString()
      if (!quote || quote.length !== 40) {
          setInfo('Invalid mint quote')
          return
      }  
      setMintQuote(quote)      
    }

    const onPasteMeltQuote = async function () {
      const quote = await Clipboard.getString()
      if (!quote || quote.length !== 40) {
          setInfo('Invalid melt quote')
          return
      }  
      setMeltQuote(quote)      
    }

    const onMintEcashFromQuote = async function () {
      setIsLoading(true)
      toggleMintQuoteModal()
      try {
        if(!mintBalanceToRecoverFrom) {
          throw new AppError(Err.VALIDATION_ERROR, 'Mint is not selected.')
        }

        if(mintQuote.length !== 40) {
          throw new AppError(Err.VALIDATION_ERROR, 'Mint quote must have 40 characters.')
        }

        const result = await WalletTask.recoverMintQuote({
          mintUrl: mintBalanceToRecoverFrom.mintUrl,
          mintQuote
        })

        setIsLoading(false)

        if(result.recoveredAmount > 0) {
          setMintedAmount(result.recoveredAmount)
          toggleMintQuoteResultModal()
          resetState()
        } else {
          throw new AppError(Err.MINT_ERROR, 'Could not mint ecash from provided mint quote.')
        }
      } catch (e: any) {
        handleError(e)
      }
    }

    const onRecoverChangeFromQuote = async function () {
      setIsLoading(true)
      toggleMeltQuoteModal()
      try {
        if(!mintBalanceToRecoverFrom) {
          throw new AppError(Err.VALIDATION_ERROR, 'Mint is not selected.')
        }

        if(meltQuote.length !== 40) {
          throw new AppError(Err.VALIDATION_ERROR, 'Melt quote must have 40 characters.')
        }

        const result = await WalletTask.recoverMeltQuoteChange({
          mintUrl: mintBalanceToRecoverFrom.mintUrl,
          meltQuote
        })

        setIsLoading(false)

        if(result.recoveredAmount > 0) {
          setMeltChangeAmount(result.recoveredAmount)
          toggleMeltQuoteResultModal()
          resetState()
        } else {
          throw new AppError(Err.MINT_ERROR, 'Could not recover any change from provided melt quote.')
        }
      } catch (e: any) {
        handleError(e)
      }
    }

    const handleError = function (e: AppError): void {
      log.error(e.name, e.message)
      resetState()
      setError(e)
    }

    const startMeltQuoteRecovery = function(): void {
      setIsMeltQuoteRecoveryStarted(true)
      toggleMintSelectorModal()
      
    }
  
    const startMintQuoteRecovery = function(): void {
      setIsMintQuoteRecoveryStarted(true)
      toggleMintSelectorModal()
    }

    const resetState = function () {
      setIsLoading(false)
      setError(undefined)
      setInfo('')
      setMintedAmount(0)
      setMeltChangeAmount(0)
      setMintQuote('')
      setMeltQuote('')
      setIsSyncStateSentToQueue(false)
      setIsMintQuoteRecoveryStarted(false)
      setIsMeltQuoteRecoveryStarted(false)
      setMintBalanceToRecoverFrom(mintBalancesRef.current[0])
    }

    const headerBg = useThemeColor('header')
    const inputBg = useThemeColor('background')
    const mintsModalBg = useThemeColor('background')
    const inputText = useThemeColor('text')
  

    return (
      <Screen preset="fixed" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <Text
              preset="heading"
              tx="recoveryOptions.title"
              style={{color: 'white'}}
            />
        </View>
        <ScrollView style={$contentContainer}>  
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
                style={$card}                HeadingComponent={                               
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
              <Card
                label='Experimental tools'
                style={[$card, {marginBottom: spacing.huge * 2}]}
                HeadingComponent={
                <>         
                    <ListItem
                          text="Recover mint quote"
                          subText="Retry to mint ecash from an already paid mint quote."
                          leftIcon='faCoins'
                          leftIconColor={colors.palette.orange400}
                          leftIconInverse={true}
                          RightComponent={
                              <View style={$rightContainer}>
                                  <Button
                                      onPress={startMintQuoteRecovery}
                                      text='Start'
                                      preset='secondary'                                           
                                  /> 
                              </View>                           
                          } 
                          style={$item}                        
                    />       
                    <ListItem
                        text="Recover melt quote change"
                        subText="Retry to receive back unspent ecash from a completed Lightning payment."
                        leftIcon='faArrowTurnDown'
                        leftIconColor={colors.palette.iconGreyBlue400}
                        leftIconInverse={true}
                        topSeparator={true}
                        RightComponent={
                            <View style={$rightContainer}>
                                <Button
                                    onPress={startMeltQuoteRecovery}
                                    text='Start'
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
          {isLoading && <Loading />}        
          {error && <ErrorModal error={error} />}
          {info && <InfoModal message={info} />}                    
        </ScrollView>
        <BottomModal
          isVisible={isNotificationModalVisible ? true : false}          
          ContentComponent={
            <>
              <ResultModalInfo
                icon="faTriangleExclamation"
                iconColor={colors.palette.accent300}
                title={"Permission needed"}
                message={"Minibits needs a permission to display notification while this task will be running."}
              />
              <View style={$buttonContainer}>
                <Button
                    preset="secondary"
                    text={'Open settings'}
                    onPress={openNotificationSettings}
                />                      
              </View>
            </>
          }
          onBackButtonPress={toggleNotificationModal}
          onBackdropPress={toggleNotificationModal}
        />
        <BottomModal
          isVisible={isMintSelectorModalVisible ? true : false}
          style={{backgroundColor: mintsModalBg}}         
          ContentComponent={
            <View style={$mintsContainer}>
              <MintBalanceSelector
                mintBalances={mintBalancesRef.current}              
                unit={unitRef.current}
                title='Select mint to recover from'
                confirmTitle={'Confirm'}
                collapsible={false}                
                onMintBalanceSelect={onMintBalanceSelect}
                selectedMintBalance={mintBalanceToRecoverFrom}
                onCancel={onMintBalanceCancel}              
                onMintBalanceConfirm={onMintBalanceConfirm}
              />
            </View>
          }
          onBackButtonPress={toggleMintSelectorModal}
          onBackdropPress={toggleMintSelectorModal}
        />
        <BottomModal
          isVisible={isMintQuoteModalVisible ? true : false}          
          ContentComponent={
            <View style={$quoteContainer}>
                <Text text='Enter mint quote' />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                    <TextInput
                        ref={mintQuoteInputRef}
                        onChangeText={(quote) => setMintQuote(quote)}
                        value={mintQuote}
                        autoCapitalize='none'
                        keyboardType='default'
                        maxLength={40}                        
                        selectTextOnFocus={true}
                        style={[$quoteInput, {backgroundColor: inputBg, color: inputText}]}
                    />
                    <Button
                        tx={'common.paste'}
                        preset='secondary'
                        style={$pasteButton}
                        onPress={onPasteMintQuote}
                    />                    
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                    <Button onPress={onMintEcashFromQuote} text='Mint ecash' />
                </View>                
            </View>
          }
          onBackButtonPress={toggleMintQuoteModal}
          onBackdropPress={toggleMintQuoteModal}
        />
        <BottomModal
          isVisible={isMintQuoteModalVisible ? true : false}          
          ContentComponent={
            <View style={$quoteContainer}>
                <Text text='Enter mint quote' />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                    <TextInput
                        ref={mintQuoteInputRef}
                        onChangeText={(quote) => setMintQuote(quote)}
                        value={mintQuote}
                        autoCapitalize='none'
                        keyboardType='default'
                        maxLength={40}                        
                        selectTextOnFocus={true}
                        style={[$quoteInput, {backgroundColor: inputBg, color: inputText}]}
                    />
                    <Button
                        tx={'common.paste'}
                        preset='secondary'
                        style={$pasteButton}
                        onPress={onPasteMintQuote}
                    />                    
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                    <Button onPress={onMintEcashFromQuote} text='Mint ecash' />
                </View>                
            </View>
          }
          onBackButtonPress={toggleMintQuoteModal}
          onBackdropPress={toggleMintQuoteModal}
        />
        <BottomModal
          isVisible={isMintQuoteResultModalVisible ? true : false}          
          ContentComponent={
            <>
              <ResultModalInfo
                icon="faCheckCircle"
                iconColor={colors.palette.success200}
                title="Success!"
                message={`Successfully minted ${mintedAmount} SAT from the provided mint quote.`}
              />
              <View style={$buttonContainer}>
                <Button
                    preset="secondary"
                    tx={'common.close'}
                    onPress={toggleMintQuoteResultModal}
                />                      
              </View>
            </>
          }
          onBackButtonPress={toggleMintQuoteResultModal}
          onBackdropPress={toggleMintQuoteResultModal}
        />
        <BottomModal
          isVisible={isMeltQuoteModalVisible ? true : false}          
          ContentComponent={
            <View style={$quoteContainer}>
                <Text text='Enter melt quote' />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                    <TextInput
                        ref={mintQuoteInputRef}
                        onChangeText={(quote) => setMeltQuote(quote)}
                        value={meltQuote}
                        autoCapitalize='none'
                        keyboardType='default'
                        maxLength={40}                        
                        selectTextOnFocus={true}
                        style={[$quoteInput, {backgroundColor: inputBg, color: inputText}]}
                    />
                    <Button
                        tx={'common.paste'}
                        preset='secondary'
                        style={$pasteButton}
                        onPress={onPasteMeltQuote}
                    />                    
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                    <Button onPress={onRecoverChangeFromQuote} text='Recover change' />
                </View>                
            </View>
          }
          onBackButtonPress={toggleMintQuoteModal}
          onBackdropPress={toggleMintQuoteModal}
        />
        <BottomModal
          isVisible={isMeltQuoteResultModalVisible ? true : false}          
          ContentComponent={
            <>
              <ResultModalInfo
                icon="faCheckCircle"
                iconColor={colors.palette.success200}
                title="Success!"
                message={`Successfully recovered ${meltChangeAmount} SAT from the provided melt quote.`}
              />
              <View style={$buttonContainer}>
                <Button
                    preset="secondary"
                    tx={'common.close'}
                    onPress={toggleMeltQuoteResultModal}
                />                      
              </View>
            </>
          }
          onBackButtonPress={toggleMeltQuoteResultModal}
          onBackdropPress={toggleMeltQuoteResultModal}
        />
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  //flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.15,
}

const $contentContainer: TextStyle = {
  //flex: 1,
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $mintsContainer: TextStyle = {
  // flex: 1, 
  alignSelf: 'stretch',
  minHeight: spacing.screenHeight * 0.4,
}

const $quoteContainer: TextStyle = {
  // flex: 1,
  padding: spacing.small,
  alignSelf: 'stretch',
  minHeight: spacing.screenHeight * 0.3,
}

const $pasteButton: ViewStyle = {
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
  alignSelf: 'stretch',
  justifyContent: 'center',
  marginLeft: 1
}

const $quoteInput: TextStyle = {
  flex: 1,    
  borderTopLeftRadius: spacing.small,
  borderBottomLeftRadius: spacing.small,
  fontSize: 16,
  padding: spacing.small,
  alignSelf: 'stretch',
  textAlignVertical: 'top',
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

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}
