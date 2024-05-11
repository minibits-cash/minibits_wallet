import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Switch, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation'
import {
  Icon,
  ListItem,
  Screen,
  Text,
  Card,
  Loading,
  ErrorModal,
  InfoModal,
  BottomModal,
  Button,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import EventEmitter from '../utils/eventEmitter'
import {ResultModalInfo} from './Wallet/ResultModalInfo'
import {Database, log, WalletTask, WalletTaskResult} from '../services'
import { getSnapshot } from 'mobx-state-tree'

export const BackupScreen: FC<SettingsStackScreenProps<'Backup'>> = observer(function BackupScreen(_props) {
    const {navigation} = _props
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const {userSettingsStore, proofsStore, mintsStore} = useStores()

    const [isLoading, setIsLoading] = useState(false)
    const [isLocalBackupOn, setIsLocalBackupOn] = useState<boolean>(
      userSettingsStore.isLocalBackupOn,
    )
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')
    const [isBackupModalVisible, setIsBackupModalVisible] =
      useState<boolean>(false)
    const [isHandleSpentFromSpendableSentToQueue, setIsHandleSpentFromSpendableSentToQueue] = useState<boolean>(false)
    const [backupResultMessage, setBackupResultMessage] = useState<string>()
    const [totalSpentCount, setTotalSpentCount] = useState<number>(0)
    const [totalSpentAmount, setTotalSpentAmount] = useState<number>(0)


    useEffect(() => {
        const handleSpentByMintTaskResult = async (result: WalletTaskResult) => {
            log.warn('handleSpentByMintTaskResult event handler triggered')
            
            setIsLoading(false)            
            // runs per each mint
            if (result && result.spentAmount > 0) {
                setTotalSpentAmount(prev => prev + result.spentAmount)
                setTotalSpentCount(prev => prev + result.spentCount)
                setInfo(
                    `${totalSpentCount} ecash proofs, ${totalSpentAmount} in total were removed from the wallet.`,
                )
                return
            }
        
            setInfo('No spent ecash found in your wallet')            
        }
        
        EventEmitter.on('ev__handleSpentByMintTask_result', handleSpentByMintTaskResult)
        
        return () => {
            EventEmitter.off('ev__handleSpentByMintTask_result', handleSpentByMintTaskResult)            
        }
    }, [isHandleSpentFromSpendableSentToQueue])

    const toggleBackupSwitch = () => {
      try {
        setIsLoading(true)
        const result = userSettingsStore.setIsLocalBackupOn(!isLocalBackupOn)
        setIsLocalBackupOn(result)

        if (result === true) { 
                    
          log.trace('[toggleBackupSwitch]', JSON.stringify(proofsStore.getBalances()))
          
          if(proofsStore.allProofs.length > 0){
            log.trace('[toggleBackupSwitch]', JSON.stringify(proofsStore.allProofs))
            Database.addOrUpdateProofs(proofsStore.allProofs)
          }
          if(proofsStore.allPendingProofs.length > 0){
            Database.addOrUpdateProofs(proofsStore.allPendingProofs, true)
          }

          setBackupResultMessage(
            'Your minibits tokens were backed up to local database. New tokens will be backed up automatically.',
          )
          toggleBackupModal()
          setIsLoading(false)
          return
        }

        Database.removeAllProofs()
        setIsLoading(false)
        setBackupResultMessage(
          'Your backup of minibits tokens has been deleted. New tokens will NOT be backed up.',
        )
        toggleBackupModal()
      } catch (e: any) {
        handleError(e)
      }
    }

    const toggleBackupModal = () =>
      setIsBackupModalVisible(previousState => !previousState)

    const gotoLocalRecovery = function () {
      navigation.navigate('LocalRecovery')
    }

    const gotoRemoteBackup = function () {
        navigation.navigate('RemoteBackup')
      }

    const checkSpent = async function () {
      setIsLoading(true)
      setIsHandleSpentFromSpendableSentToQueue(true)
      WalletTask.handleSpentFromSpendable()      
    }


    const increaseCounters = async function () {
        for (const mint of mintsStore.allMints) {
          for(const counter of mint.proofsCounters) {
            mint.increaseProofsCounter(counter.keyset, 50)
          }            
        }  
        setInfo('Recovery indexes increased by 50')
    }


    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }

    const headerBg = useThemeColor('header')

    return (
      <Screen preset='auto' style={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Backup" style={{color: 'white'}} />
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
                    />
                </>
                }
            />
            <Card
                style={$card}
                HeadingComponent={
                <>
                    <ListItem
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
                    />
                    {isLocalBackupOn && (
                    <ListItem
                        tx="backupScreen.recoveryTool"
                        subTx="backupScreen.recoveryToolDescription"
                        leftIcon='faUpload'
                        leftIconColor={colors.palette.focus300}
                        leftIconInverse={true}
                        style={$item}
                        onPress={gotoLocalRecovery}
                        topSeparator={true}
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
                        text="Increase recovery indexes"
                        subText={`After migration from old wallet to the wallet that can be recovered with seed phrase, you may in rare cases encounter 'duplicate outputs' error when trying to send. This resets your recovery indexes to higher value in order to resolve the issue.`}
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
              title={
                isLocalBackupOn ? 'Local backup is on' : 'Local backup is off'
              }
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
