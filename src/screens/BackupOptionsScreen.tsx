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
  Button,
  Header,
} from '../components'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import {log, SyncStateTaskResult, WalletTask} from '../services'
import { translate } from '../i18n'

export const BackupOptionsScreen: FC<SettingsStackScreenProps<'BackupOptions'>> = observer(function BackupOptionsScreen(_props) {
    const {navigation} = _props
    const {mintsStore} = useStores()
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')
    const [isSyncStateSentToQueue, setIsSyncStateSentToQueue] = useState<boolean>(false)    
    const [totalSpentAmount, setTotalSpentAmount] = useState<number>(0)   
    
    

    const gotoExportBackup = function () {
      navigation.navigate('ExportBackup')
    }

    const gotoMnemonic = function () {
        navigation.navigate('Mnemonic')
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
                    tx="backupScreen.mnemonicTitle"
                    subTx="backupScreen.mnemonicDescription"
                    leftIcon='faUpRightFromSquare'
                    leftIconColor={colors.palette.blue200}
                    leftIconInverse={true}
                    style={$item}
                    onPress={gotoMnemonic}
                    // bottomSeparator={true}
                  />
                  {/*<ListItem
                    tx="walletAddressRecovery"
                    subTx="walletAddressRecoveryDesc"
                    leftIcon='faCircleUser'
                    leftIconColor={colors.palette.iconGreyBlue400}
                    leftIconInverse={true}
                    style={$item}
                    onPress={gotoRemoteRecovery}
                />*/}
                </>
                }
            />
            <Card
                style={$card}
                HeadingComponent={
                <>
                    <ListItem
                        text='Wallet backup'
                        subText='Export wallet backup so that you can import it into another wallet.'                        
                        leftIcon='faUpload'
                        leftIconColor={colors.palette.focus300}
                        leftIconInverse={true}
                        style={$item}
                        onPress={gotoExportBackup}
                        // topSeparator={true}
                    /> 
                    {/*<ListItem
                    tx="backupScreen.localBackupOptions"
                    subTx="backupScreen.localBackupOptionsDescription"
                    leftIcon='faDownload'
                    leftIconColor={
                        isLocalBackupOptionsOn
                        ? colors.palette.success200
                        : colors.palette.neutral400
                    }
                    leftIconInverse={true}
                    RightComponent={
                        <View style={$rightContainer}>
                        <Switch
                            onValueChange={toggleBackupOptionsSwitch}
                            value={isLocalBackupOptionsOn}
                        />
                        </View>
                    }
                    style={$item}
                  />*/}
                   
                  
                </>
                }
            />                   
        {isLoading && <Loading />}
        </View>        
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