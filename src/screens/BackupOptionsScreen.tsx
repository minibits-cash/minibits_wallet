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
import AppError from '../utils/AppError'

export const BackupOptionsScreen: FC<SettingsStackScreenProps<'BackupOptions'>> = observer(
  function BackupOptionsScreen(_props) {
    
    const {navigation} = _props    
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')    
    

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
      <Screen preset='scroll' contentContainerStyle={$screen}>
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
                    leftIcon='faSeedling'
                    leftIconColor={colors.palette.blue200}
                    leftIconInverse={true}
                    style={$item}
                    onPress={gotoMnemonic}                    
                  />
                </>
                }
            />
            <Card
                style={$card}
                HeadingComponent={
                <>
                  <ListItem
                      text='Wallet backup'
                      subText='Export wallet backup so that you can import it into a new device.'                        
                      leftIcon='faUpload'
                      leftIconColor={colors.palette.focus300}
                      leftIconInverse={true}
                      style={$item}
                      onPress={gotoExportBackup}                      
                  /> 
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

const $screen: ViewStyle = {
  flex: 1
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.2,
}

const $contentContainer: TextStyle = {
  marginTop: -spacing.extraLarge * 2,
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