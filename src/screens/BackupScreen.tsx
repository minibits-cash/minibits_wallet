import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation'
import {
  ListItem,
  Screen,
  Text,
  Card,
  Loading,
  ErrorModal,
  InfoModal,
  BottomModal,
  Button,
  Header,
} from '../components'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {log, SyncStateTaskResult, WalletTask, WalletTaskResult} from '../services'
import { translate } from '../i18n'

export const BackupScreen: FC<SettingsStackScreenProps<'Backup'>> = observer(function BackupScreen(_props) {
    const {navigation} = _props
    const {userSettingsStore, proofsStore, mintsStore} = useStores()

    const [isLoading, setIsLoading] = useState(false)
    const [isLocalBackupOn, setIsLocalBackupOn] = useState<boolean>(
      userSettingsStore.isLocalBackupOn,
    )
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')
    const [isBackupModalVisible, setIsBackupModalVisible] =
      useState<boolean>(false)
    const [isSyncStateSentToQueue, setIsSyncStateSentToQueue] = useState<boolean>(false)
    const [backupResultMessage, setBackupResultMessage] = useState<string>()
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
        
        EventEmitter.on('ev__syncStateWithMintTask_result', removeSpentByMintTaskResult)
        
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


    const toggleBackupModal = () =>
      setIsBackupModalVisible(previousState => !previousState)

    const gotoExportEcash = function () {
      navigation.navigate('ExportEcash')
    }

    const gotoRemoteBackup = function () {
        navigation.navigate('RemoteBackup')
    }

    const gotoRemoteRecovery = function () {
      navigation.navigate('RemoteRecovery', {isAddressOnlyRecovery: true})
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
      setIsLoading(false)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const headerTitle = useThemeColor('headerTitle')

    return (
      <Screen preset='auto' contentContainerStyle={$screen}>
        <Header                
            leftIcon='faArrowLeft'
            onLeftPress={() => navigation.goBack()}                            
        /> 
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Backup" style={{color: headerTitle}} />
        </View>
        <View style={$contentContainer}>
            <Card
                style={$card}
                HeadingComponent={
                <>                
                  <ListItem
                    tx="backupScreen.remoteBackup"
                    subTx="backupScreen.remoteBackupDescription"
                    leftIcon='faUpRightFromSquare'
                    leftIconColor={colors.palette.blue200}
                    leftIconInverse={true}
                    style={$item}
                    onPress={gotoRemoteBackup}
                    bottomSeparator={true}
                  />
                  <ListItem
                    tx="walletAddressRecovery"
                    subTx="walletAddressRecoveryDesc"
                    leftIcon='faCircleUser'
                    leftIconColor={colors.palette.iconGreyBlue400}
                    leftIconInverse={true}
                    style={$item}
                    onPress={gotoRemoteRecovery}
                  />
                </>
                }
            />
            <Card
                style={$card}
                HeadingComponent={
                <>
                    {/*<ListItem
                    tx="backupScreen.localBackup"
                    subTx="backupScreen.localBackupDescription"
                    leftIcon='faDownload'
                    leftIconColor={
                        isLocalBackupOn
                        ? colors.palette.success200
                        : colors.palette.neutral400
                    }
                    leftIconInverse={true}
                    RightComponent={
                        <View style={$rightContainer}>
                        <Switch
                            onValueChange={toggleBackupSwitch}
                            value={isLocalBackupOn}
                        />
                        </View>
                    }
                    style={$item}
                  />*/}
                    {isLocalBackupOn && (
                    <ListItem
                        tx="backupScreen.recoveryTool"
                        subTx="backupScreen.recoveryToolDescription"
                        leftIcon='faUpload'
                        leftIconColor={colors.palette.focus300}
                        leftIconInverse={true}
                        style={$item}
                        onPress={gotoExportEcash}
                        // topSeparator={true}
                    />
                    )}                
                </>
                }
            />
            <Card
                style={$card}
                HeadingComponent={
                <>                
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
                </>
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
        {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isBackupModalVisible}          
          style={{paddingHorizontal: spacing.small}}
          ContentComponent={
            <ResultModalInfo
              icon={'faDownload'}
              iconColor={
                isLocalBackupOn
                  ? colors.palette.success200
                  : colors.palette.neutral400
              }
              // title={
              //   isLocalBackupOn ? 'Local backup is on' : 'Local backup is off'
              // }
              title={translate(isLocalBackupOn ? 'localBackupEnabled' : 'localBackupDisabled')}
              message={backupResultMessage as string}
            />
          }
          onBackButtonPress={toggleBackupModal}
          onBackdropPress={toggleBackupModal}
        />
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)

const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.1,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  // padding: spacing.extraSmall,
  // alignSelf: 'center',
  marginLeft: spacing.tiny,
  marginRight: -10
}
