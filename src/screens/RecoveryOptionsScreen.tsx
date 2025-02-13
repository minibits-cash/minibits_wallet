import {observer} from 'mobx-react-lite'
import React, {useState, useEffect} from 'react'
import {TextStyle, View, ViewStyle} from 'react-native'
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
} from '../components'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError from '../utils/AppError'
import { useStores } from '../models'
import { SYNC_STATE_WITH_ALL_MINTS_TASK, SyncStateTaskResult } from '../services/walletService'
import EventEmitter from '../utils/eventEmitter'
import { translate } from '../i18n'
import { NotificationService } from '../services/notificationService'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

type Props = StaticScreenProps<{
  fromScreen?: string
}>

export const RecoveryOptionsScreen = observer(function RecoveryOptionsScreen({ route }: Props) {
    const navigation = useNavigation()
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    }) 
    
    const {mintsStore} = useStores()
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')
    const [isSyncStateSentToQueue, setIsSyncStateSentToQueue] = useState<boolean>(false)    


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



    const gotoSeedRecovery = function () {
      navigation.navigate('SeedRecovery')
    }


    const gotoImportBackup = function () {
      navigation.navigate('ImportBackup')
    }


    const gotoAddressRecovery = function () {
      navigation.navigate('RecoverWalletAddress')
    }


    const checkSpent = async function () {
      setIsLoading(true)
      setIsSyncStateSentToQueue(true)

      await NotificationService.createForegroundNotification(
        'Cleaning spent ecash from spendable balance...',
        {task: SYNC_STATE_WITH_ALL_MINTS_TASK}
      )
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

    const handleError = function (e: AppError): void {
      log.error(e.name, e.message)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    
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
          {isLoading && <Loading />}        
          {error && <ErrorModal error={error} />}
          {info && <InfoModal message={info} />}                    
        </View>

      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  flex: 1,
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
