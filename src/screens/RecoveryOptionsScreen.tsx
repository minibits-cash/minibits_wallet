import {observer} from 'mobx-react-lite'
import React, {useState, useEffect, useRef, useLayoutEffect} from 'react'
import {Platform, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
} from 'react-native-reanimated'
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
  Header,
  AnimatedHeader,
} from '../components'
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

type Props = StaticScreenProps<undefined>

export const RecoveryOptionsScreen = observer(function RecoveryOptionsScreen(_: Props) {
    const navigation = useNavigation()
    const scrollY = useSharedValue(0)
    const HEADER_SCROLL_DISTANCE = spacing.screenHeight * 0.07

    useLayoutEffect(() => {
      navigation.setOptions({
        headerShown: true,
        header: () => (
          <Header
            titleTx="recoveryOptionsTitle"
            leftIcon="faArrowLeft"
            onLeftPress={() => navigation.goBack()}
            scrollY={scrollY}
            scrollDistance={HEADER_SCROLL_DISTANCE}
          />
        ),
      })
    }, [])

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

    const gotoSeedRecoveryOptions = function () {
      //@ts-ignore
      navigation.navigate('SeedRecoveryOptions')
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
        await NotificationService.createTaskNotification(
          'Cleaning spent ecash from spendable balance...',
          {task: SYNC_STATE_WITH_ALL_MINTS_TASK}
        )
      } else {
        // iOS does not support fg notifications with long running tasks
        await WalletTask.syncStateWithAllMintsQueueAwaitable({isPending: false})        
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

      if(mintBalanceToRecoverFrom) {
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
          setInfo(translate('recoveryInvalidMintQuote'))
          return
      }  
      setMintQuote(quote)      
    }

    const onPasteMeltQuote = async function () {
      const quote = await Clipboard.getString()
      if (!quote || quote.length !== 40) {
          setInfo(translate('recoveryInvalidMeltQuote'))
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
      //setMintedAmount(0)
      //setMeltChangeAmount(0)
      setMintQuote('')
      setMeltQuote('')
      setIsSyncStateSentToQueue(false)
      setIsMintQuoteRecoveryStarted(false)
      setIsMeltQuoteRecoveryStarted(false)
      setMintBalanceToRecoverFrom(mintBalancesRef.current[0])
    }

    const inputBg = useThemeColor('background')
    const mintsModalBg = useThemeColor('background')
    const inputText = useThemeColor('text')

    const scrollHandler = useAnimatedScrollHandler({
      onScroll: (event) => {
        scrollY.value = event.contentOffset.y
      },
    })

    return (
      <Screen preset="fixed" contentContainerStyle={$screen}>
        <AnimatedHeader
          titleTx="recoveryOptionsTitle"
          scrollY={scrollY}
          scrollDistance={HEADER_SCROLL_DISTANCE}
        />
        <Animated.ScrollView
          style={$contentContainer}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
        >
          <Card
            style={$card}
            HeadingComponent={
              <ListItem
                tx="seedRecoveryOptions"
                subTx="seedRecoveryOptionsDesc"
                leftIcon='faSeedling'
                leftIconColor={colors.palette.orange400}
                leftIconInverse={true}
                style={$item}
                onPress={gotoSeedRecoveryOptions}
              />
            }
          />

          <Card
            style={$card}
            HeadingComponent={ 
              <>                              
                <ListItem
                  tx="backupRemoveSpentCoins"
                  subTx="backupRemoveSpentCoinsDescription"
                  leftIcon='faRecycle'
                  leftIconColor={colors.palette.secondary300}
                  leftIconInverse={true}
                  RightComponent={
                    <View style={$rightContainer}>
                        <Button
                          onPress={checkSpent}
                          tx='recoveryScreen_remove'
                          preset='secondary'                                           
                        /> 
                    </View>                           
                  }
                  style={$item}                        
                />
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
                              tx='recoveryScreen_increase'
                              preset='secondary'                                           
                          /> 
                      </View>                           
                  }
                  topSeparator={true}
                  style={$item}                        
                />
              </>
            }
          /> 
          <Card
            labelTx='recoveryScreen_experimentalTools'
            style={[$card, {marginBottom: spacing.huge * 2}]}
            HeadingComponent={
            <>         
                <ListItem
                      tx="recoveryScreen_recoverMintQuote"
                      subTx="recoveryScreen_recoverMintQuoteDesc"
                      leftIcon='faCoins'
                      leftIconColor={colors.palette.orange400}
                      leftIconInverse={true}
                      RightComponent={
                          <View style={$rightContainer}>
                              <Button
                                  onPress={startMintQuoteRecovery}
                                  tx='recoveryScreen_start'
                                  preset='secondary'                                           
                              /> 
                          </View>                           
                      } 
                      style={$item}                        
                />       
                <ListItem
                    tx="recoveryScreen_recoverMeltQuoteChange"
                    subTx="recoveryScreen_recoverMeltQuoteChangeDesc"
                    leftIcon='faArrowTurnDown'
                    leftIconColor={colors.palette.iconGreyBlue400}
                    leftIconInverse={true}
                    topSeparator={true}
                    RightComponent={
                        <View style={$rightContainer}>
                            <Button
                                onPress={startMeltQuoteRecovery}
                                tx='recoveryScreen_start'
                                preset='secondary'                                           
                            /> 
                        </View>                           
                    } 
                    style={$item}                        
                />
            </>
            }
          />
          {isLoading && <Loading />}
          {error && <ErrorModal error={error} />}
          {info && <InfoModal message={info} />}
        </Animated.ScrollView>
        <BottomModal
          isVisible={isNotificationModalVisible ? true : false}          
          ContentComponent={
            <>
              <ResultModalInfo
                icon="faTriangleExclamation"
                iconColor={colors.palette.accent300}
                title={translate("recoveryPermissionNeededTitle")}
                message={translate("recoveryPermissionNeededDesc")}
              />
              <View style={$buttonContainer}>
                <Button
                    preset="secondary"
                    tx={'recoveryOpenSettingsButton'}
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
                title={translate('recoveryScreen_selectMintToRecoverFrom')}
                confirmTitle={translate('recoveryScreen_confirm')}
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
                <Text tx='recoveryEnterMintQuote' />
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
                        tx='commonPaste'
                        preset='secondary'
                        style={$pasteButton}
                        onPress={onPasteMintQuote}
                    />                    
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                    <Button onPress={onMintEcashFromQuote} tx="recoveryMintEcashButton" />
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
                title={translate("recoverySuccessTitle")}
                message={translate("recoveryMintSuccessMessage", {amount: mintedAmount})}
              />
              <View style={$buttonContainer}>
                <Button
                    preset="secondary"
                    tx={'commonClose'}
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
                <Text tx='recoveryEnterMeltQuote' />
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
                        tx={'commonPaste'}
                        preset='secondary'
                        style={$pasteButton}
                        onPress={onPasteMeltQuote}
                    />                    
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                    <Button onPress={onRecoverChangeFromQuote} tx='recoveryRecoverChangeButton' />
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
                title={translate("recoverySuccessTitle")}
                message={translate("recoveryMeltSuccessMessage", {amount: meltChangeAmount})}
              />
              <View style={$buttonContainer}>
                <Button
                    preset="secondary"
                    tx={'commonClose'}
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
  // flex: 1,
}

const $contentContainer: TextStyle = {
  //flex: 1,
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $mintsContainer: TextStyle = {
  flex: 0,
  // alignItems: 'flex-start',
  alignSelf: 'stretch',
  minHeight: spacing.screenHeight * 0.4,
}

const $quoteContainer: TextStyle = {
  // flex: 1,
  padding: spacing.small,
  // alignSelf: 'stretch',
  maxHeight: spacing.screenHeight * 0.3,
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
