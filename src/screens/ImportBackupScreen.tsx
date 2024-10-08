import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, LayoutAnimation, Platform, Pressable, Switch, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {validateMnemonic} from '@scure/bip39'
import QuickCrypto from 'react-native-quick-crypto'
import { wordlist } from '@scure/bip39/wordlists/english'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {AppStackScreenProps} from '../navigation' // @demo remove-current-line
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
  $sizeStyles,
} from '../components'
import {useHeader} from '../utils/useHeader'
import AppError, { Err } from '../utils/AppError'
import { KeyChain, log, MinibitsClient, NostrClient } from '../services'
import Clipboard from '@react-native-clipboard/clipboard'
import { useStores } from '../models'
import { MintListItem } from './Mints/MintListItem'
import {MnemonicInput} from './Recovery/MnemonicInput'
import { Mint } from '../models/Mint'
import { MintKeyset } from '@cashu/cashu-ts'
import { CashuUtils } from '../services/cashu/cashuUtils'
import { Proof } from '../models/Proof'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../models/Transaction'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { deriveSeedFromMnemonic } from '@cashu/cashu-ts'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { delay } from '../utils/utils'
import { getSnapshot, isStateTreeNode } from 'mobx-state-tree'
import { scale } from '@gocodingnow/rn-size-matters'
import { WalletUtils } from '../services/wallet/utils'
import { MintUnit, formatCurrency, getCurrency } from '../services/wallet/currency'
import { isObj } from '@cashu/cashu-ts/src/utils'
import { WalletProfileRecord } from '../models/WalletProfileStore'
import { translate } from '../i18n'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const ImportBackupScreen: FC<AppStackScreenProps<'ImportBackup'>> = observer(
  function ImportBackupScreen(_props) {
    const {navigation, route} = _props    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {            
            navigation.goBack()
        },
    })

    const {
        mintsStore, 
        proofsStore, 
        userSettingsStore, 
        transactionsStore, 
        walletProfileStore, 
        walletStore
    } = useStores()
    
    const mnemonicInputRef = useRef<TextInput>(null)
    const backupInputRef = useRef<TextInput>(null)

    const [info, setInfo] = useState('')    
    const [mnemonicExists, setMnemonicExists] = useState(false)
    const [mnemonic, setMnemonic] = useState<string>('')    
    const [isValidMnemonic, setIsValidMnemonic] = useState(false)    
    const [seed, setSeed] = useState<Uint8Array>()
    const [backup, setBackup] = useState<string>('')
    const [isValidBackup, setIsValidBackup] = useState(false)    
    const [walletSnapshot, setWalletSnapshot] = useState<any | undefined>(undefined) // type tbd
    const [profileToRecover, setProfileToRecover] = useState<WalletProfileRecord | undefined>(undefined)
    const [selectedMintUrl, setSelectedMintUrl] = useState<string | undefined>()    
    const [isLoading, setIsLoading] = useState(false)    
    const [error, setError] = useState<AppError | undefined>()        
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, message: string} | undefined>()
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)    
    const [totalRecoveredAmount, setTotalRecoveredAmount] = useState<number>(0)
    const [recoveryErrors, setRecoveryErrors] = useState<AppError[]>([])
    const [statusMessage, setStatusMessage] = useState<string>()

    useEffect(() => {
        const getMnemonic = async () => {  
            try {
                setIsLoading(true)          
                const existing = await walletStore.getMnemonic()

                if(existing) {
                    setMnemonicExists(true)
                }
                setIsLoading(false) 
            } catch (e: any) {
                handleError(e)
            } 
        }
        getMnemonic()
    }, [])


    const toggleResultModal = () => {
        if(isResultModalVisible === true) {
            setResultModalInfo(undefined)
        }
        setIsResultModalVisible(previousState => !previousState)        
    }


    const onConfirmMnemonic = async function () {
        try {
            setStatusMessage(translate("derivingSeedStatus"))
            
            if(!mnemonic) {
              throw new AppError(Err.VALIDATION_ERROR, translate('backupScreen.missingMnemonicError'))
            }

            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
            setIsLoading(true)

            if (!validateMnemonic(mnemonic, wordlist)) {
              throw new AppError(Err.VALIDATION_ERROR, translate("recoveryInvalidMnemonicError"))
            }          

            const start = performance.now()
            const binarySeed = deriveSeedFromMnemonic(mnemonic) // expensive
            const end = performance.now()
            console.log(`[onConfirm] deriveSeedFromMnemonic took ${end - start} ms.`)
    
            setSeed(binarySeed)
            setIsValidMnemonic(true)
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
            setIsLoading(false)
        } catch (e: any) {
          handleError(e)
        }
    }


    const onPasteBackup = async function () {
        try {
            const maybeBackup = await Clipboard.getString()

            if(!maybeBackup) {
                throw new AppError(Err.VALIDATION_ERROR, 'Copy and paste the wallet backup.')
            }

            const cleaned = maybeBackup.trim()
            
            setBackup(cleaned)
        } catch (e: any) {
            handleError(e)
        }
    }


    const validateBackup = async function () {
        try {
            // serialize

            // try to load as json            

            // validate against types (version?)
            return true
        } catch (e: any) {
            handleError(e)
        }
    }


    const onConfirmBackup = async function () {
        try {
            if(!backup) {
              throw new AppError(Err.VALIDATION_ERROR, 'Missing backup')
            }

            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
            setIsLoading(true)

            if (!validateBackup()) {
              throw new AppError(Err.VALIDATION_ERROR, translate("recoveryInvalidMnemonicError"))
            }
            
            // const walletSnapshot = JSON.parse(backup)
            const walletSnapshot = backup
    
            setWalletSnapshot(walletSnapshot)
            setIsValidBackup(true)
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
            setIsLoading(false)
        } catch (e: any) {
          handleError(e)
        }
    }


    const onBack = function (): void {
        return navigation.goBack()
    }

    
    const startImport = async function () {

        setStatusMessage(translate("recovery.starting"))
        setIsLoading(true)        
        // setTimeout(() => doRecovery(), 100)        
    }    


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const numIconColor = useThemeColor('textDim')
    const textHint = useThemeColor('textDim')
    const inputBg = useThemeColor('background')
    const headerTitle = useThemeColor('headerTitle')

    return (
      <Screen contentContainerStyle={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
            <Text preset="heading" text="Import backup" style={{color: headerTitle, zIndex: 10}} />
        </View>
        <View style={$contentContainer}>            
            <MnemonicInput                
                mnemonic={mnemonic}
                isValidMnemonic={isValidMnemonic}
                setMnemonic={setMnemonic}
                onConfirm={onConfirmMnemonic}
                onError={handleError}
            />
            {isValidMnemonic && !isValidBackup && (
                <Card
                    style={$card}
                    ContentComponent={
                        <ListItem
                            text="Insert wallet backup"
                            subText={'Paste the backup exported from previous wallet.'}
                            LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='2'/></View>}                  
                            style={$item}                            
                        /> 
                    }
                    FooterComponent={
                        <>
                        <TextInput
                            ref={backupInputRef}
                            onChangeText={(backup: string) => setBackup(backup)}
                            value={backup}
                            numberOfLines={3}
                            multiline={true}
                            autoCapitalize='none'
                            keyboardType='default'                            
                            placeholder={'Paste your backup'}
                            selectTextOnFocus={true}                    
                            style={[$backupInput, {backgroundColor: inputBg, flexWrap: 'wrap'}]}
                        />
                        <View style={$buttonContainer}>
                            {backup ? (
                                <Button
                                    onPress={onConfirmBackup}
                                    tx='common.confirm'                        
                                />
                            ) : (
                                <Button
                                    onPress={onPasteBackup}
                                    tx='common.paste'                        
                                />
                            )
                        }                    
                        </View>
                        </>
                    }           
                />
            )}
            {isValidMnemonic && isValidBackup && (
                <Card
                    style={$card}
                    ContentComponent={
                        <ListItem
                            text='Wallet backup'
                            subText={`${backup.slice(0, 100)}...`}
                            subTextStyle={{fontFamily: typography.code?.normal}}
                            LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='2'/></View>}                  
                            style={$item}                            
                        /> 
                    }        
                />
            )}
        </View>
        {isValidMnemonic && isValidBackup && (
        <View style={$bottomContainer}>
            <View style={$buttonContainer}>
                    <Button                        
                        text={`Import wallet`}
                        LeftAccessory={() => (
                            <Icon
                                icon='faDownload'                            
                                size={spacing.medium}                  
                            />
                        )}
                        onPress={startImport}                                               
                    />                
            </View>            
        </View>    
        )} 
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {resultModalInfo &&
                resultModalInfo.status === TransactionStatus.COMPLETED && (
                  <>
                    <ResultModalInfo
                      icon="faCheckCircle"
                      iconColor={colors.palette.success200}
                      title={translate("recovery.success")}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx='common.close'
                        onPress={toggleResultModal}
                      />
                    </View>
                  </>
                )}
              {resultModalInfo &&
                resultModalInfo.status === TransactionStatus.ERROR && (
                  <>
                    <ResultModalInfo
                      icon="faTriangleExclamation"
                      iconColor={colors.palette.angry500}
                      title={translate("recovery.failed")}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx="showErrors"
                        //onPress={toggleErrorsModal}
                      />
                    </View>
                  </>
                )}
              {resultModalInfo &&
                resultModalInfo.status === TransactionStatus.EXPIRED && (
                  <>
                    <ResultModalInfo
                      icon='faInfoCircle'
                      iconColor={colors.palette.neutral400}
                      title={translate("noEcashRecovered")}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx='common.close'
                        onPress={toggleResultModal}
                      />
                    </View>
                  </>
                )}
            </>
          }
          onBackButtonPress={toggleResultModal}
          onBackdropPress={toggleResultModal}
        />             
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
        {isLoading && <Loading statusMessage={statusMessage} textStyle={{color: 'white'}} style={{backgroundColor: headerBg, opacity: 1}}/>}    
      </Screen>
    )
})

const $screen: ViewStyle = {flex: 1}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
    flex: 1,
    marginTop: -spacing.extraLarge * 2,
    padding: spacing.extraSmall,  
}

const $bottomContainer: ViewStyle = {
    marginBottom: spacing.extraLarge   
}

const $indexContainer: TextStyle = {
    padding: spacing.small,
    alignItems: 'center',
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $numIcon: ViewStyle = {
    width: 30, 
    height: 30, 
    borderRadius: 15, 
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.medium
}

const $backupInput: TextStyle = {
    flex: 1,    
    borderRadius: spacing.small,    
    fontSize: 16,
    fontFamily: typography.code?.normal,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.small,
}

const $noteInput: TextStyle = {
    flex: 1,
    margin: spacing.small,
    borderRadius: spacing.extraSmall,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $bottomModal: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  paddingHorizontal: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  // padding: spacing.extraSmall,
  alignSelf: 'center',
  //marginLeft: spacing.small,
}
