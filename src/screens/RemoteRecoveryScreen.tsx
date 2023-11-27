import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, ImageBackground, LayoutAnimation, Linking, Platform, Switch, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {AppStackScreenProps, SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
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
import { log, MintClient, MintKeys, RestoreClient } from '../services'
import Clipboard from '@react-native-clipboard/clipboard'
import { useStores } from '../models'
import { MintListItem } from './Mints/MintListItem'
import { Mint } from '../models/Mint'
import { deriveKeysetId } from '@cashu/cashu-ts'
import { CashuUtils } from '../services/cashu/cashuUtils'
import { Proof } from '../models/Proof'
import {
    type Proof as CashuProof,
} from '@cashu/cashu-ts'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../models/Transaction'

if (Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true)
}

const RESTORE_INDEX_INTERVAL = 100

export const RemoteRecoveryScreen: FC<AppStackScreenProps<'RemoteRecovery'>> = observer(function RemoteRecoveryScreen(_props) {
    const {navigation, route} = _props    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {            
            navigation.goBack()
        },
    })

    const {mintsStore, proofsStore, userSettingsStore, transactionsStore} = useStores()
    const seedInputRef = useRef<TextInput>(null)

    const [info, setInfo] = useState('')
    const [seed, setSeed] = useState<string>('')        
    const [seedExists, setSeedExists] = useState(false)
    const [isValidSeed, setIsValidSeed] = useState(false)
    const [startIndex, setStartIndex] = useState<number>(0) // start of interval of indexes of proofs to recover
    const [endIndex, setEndIndex] = useState<number>(RESTORE_INDEX_INTERVAL) // end of interval
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [isErrorsModalVisible, setIsErrorsModalVisible] = useState(false)
    const [recoveryErrors, setRecoveryErrors] = useState<AppError[]>([])

    useEffect(() => {
        const getSeed = async () => {  
            try {
                setIsLoading(true)          
                const existing = await RestoreClient.getSeed()

                if(existing) {
                    //setSeedExists(true) // TEMP!!!
                }
                setIsLoading(false) 
            } catch (e: any) {
                handleError(e)
            } 
        }
        getSeed()
    }, [])


    const onPaste = async function () {
        try {
            const maybeSeed = await Clipboard.getString()

            if(!maybeSeed) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing seed phrase.')
            }

            setSeed(maybeSeed)
        } catch (e: any) {
            handleError(e)
        }
    }


    const onConfirm = function (): void {
        try {
            setIsLoading(true)
            if(!seed) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing seed.')
            }
            
            const seedArray: string[] = seed.trim().split(/\s+/)
            if(seedArray.length !== 12) {
                // throw new AppError(Err.VALIDATION_ERROR, 'Invalid seed phrase. Provide 12 word sequence separated by blank spaces.')  // TEMP!!!
            }

            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)

            setIsValidSeed(true)
            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }

    const onBack = function (): void {
        return navigation.goBack()
    }


    const onAddMints = function (): void {
        return navigation.navigate('Mints')
    }


    const doRecovery = async function () {

        setIsLoading(true)
        let errors: AppError[] = []
        
        for (const mint of mintsStore.allMints) {
            const transactionData: TransactionData[] = []            
            let transactionId: number = 0

            const pendingTransactionData: TransactionData[] = []
            let pendingTransactionId: number = 0

            try {
                // TODO allow input or get previous keysets from mint and try to restore from them

                const { proofs, newKeys } = await MintClient.restore(
                    mint.mintUrl, 
                    startIndex, 
                    endIndex
                )
                
                if(newKeys) {updateMintKeys(mint.mintUrl as string, newKeys)}

                const {spent, pending} = await MintClient.getSpentOrPendingProofsFromMint(
                    mint.mintUrl,
                    proofs as Proof[]
                )

                const unspent = proofs.filter(proof => !spent.includes(proof))

                if(unspent && unspent.length > 0) {

                    const amount = CashuUtils.getProofsAmount(unspent as Proof[])
                    
                    // Let's create new draft receive transaction in database
                    transactionData.push({
                        status: TransactionStatus.PREPARED,
                        amount,
                        createdAt: new Date(),
                    })

                    const newTransaction: Transaction = {
                        type: TransactionType.RECEIVE,
                        amount,
                        data: JSON.stringify(transactionData),
                        memo: 'Recovered ecash',
                        mint: mint.mintUrl,
                        status: TransactionStatus.PREPARED,
                    }

                    const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
                    transactionId = draftTransaction.id as number

                    addCashuProofs(
                        unspent,
                        mint.mintUrl,
                        transactionId as number                
                    )

                    // Finally, update completed transaction
                    transactionData.push({
                        status: TransactionStatus.COMPLETED,                        
                        createdAt: new Date(),
                    })

                    const completedTransaction = await transactionsStore.updateStatus(
                        transactionId,
                        TransactionStatus.COMPLETED,
                        JSON.stringify(transactionData),
                    )
                }
           
                if(pending && pending.length > 0) {
                    const amount = CashuUtils.getProofsAmount(pending as Proof[])
                    
                    // Let's create new draft receive transaction in database
                    pendingTransactionData.push({
                        status: TransactionStatus.PREPARED,
                        amount,
                        createdAt: new Date(),
                    })

                    const newTransaction: Transaction = {
                        type: TransactionType.RECEIVE,
                        amount,
                        data: JSON.stringify(transactionData),
                        memo: 'Recovered pending ecash',
                        mint: mint.mintUrl,
                        status: TransactionStatus.PREPARED,
                    }

                    const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
                    pendingTransactionId = draftTransaction.id as number

                    addCashuProofs(
                        pending,
                        mint.mintUrl,
                        pendingTransactionId as number,
                        true  // isPending = true              
                    )

                    // Finally, update pending transaction
                    pendingTransactionData.push({
                        status: TransactionStatus.PENDING,                        
                        createdAt: new Date(),
                    })

                    const pendingTransaction = await transactionsStore.updateStatus(
                        pendingTransactionId,
                        TransactionStatus.PENDING,
                        JSON.stringify(pendingTransactionData),
                    )
                }

            } catch(e: any) {
                e.params.mintUrl = mint.mintUrl
                errors.push(e)

                if (transactionId > 0) {
                    transactionData.push({
                        status: TransactionStatus.ERROR,
                        error: formatError(e),
                        createdAt: new Date(),
                    })
    
                    const errorTransaction = await transactionsStore.updateStatus(
                        transactionId,
                        TransactionStatus.ERROR,
                        JSON.stringify(transactionData),
                    )
                }

                if (pendingTransactionId > 0) {
                    pendingTransactionData.push({
                        status: TransactionStatus.ERROR,
                        error: formatError(e),
                        createdAt: new Date(),
                    })
    
                    const errorTransaction = await transactionsStore.updateStatus(
                        pendingTransactionId,
                        TransactionStatus.ERROR,
                        JSON.stringify(pendingTransactionData),
                    )
                }

                continue
            }
        }

        setStartIndex(startIndex + RESTORE_INDEX_INTERVAL)
        setEndIndex(endIndex + RESTORE_INDEX_INTERVAL)
        setIsLoading(false)
        
        if(errors.length > 0) {
            setRecoveryErrors(errors)
            toggleErrorsModal() // open
        }
    }


    // TODO: make it DRY with walletService
    const updateMintKeys = function (mintUrl: string, newKeys: MintKeys) {
        if(!CashuUtils.validateMintKeys(newKeys)) {
            // silent
            log.warn('[_updateMintKeys]', 'Invalid mint keys to update, skipping', newKeys)
            return
        }
    
        const keyset = deriveKeysetId(newKeys)
        const mint = mintsStore.findByUrl(mintUrl)
    
        return mint?.updateKeys(keyset, newKeys)
    }


    // TODO: make it DRY with walletService
    const addCashuProofs = function (
        proofsToAdd: CashuProof[],
        mintUrl: string,
        transactionId: number,
        isPending: boolean = false    
    ): {  
        amountToAdd: number,  
        addedAmount: number
    } {
        // Add internal references
        for (const proof of proofsToAdd as Proof[]) {
            proof.tId = transactionId
            proof.mintUrl = mintUrl
        }
        
        const amountToAdd = CashuUtils.getProofsAmount(proofsToAdd as Proof[])    
        // Creates proper model instances and adds them to the wallet    
        const addedAmount = proofsStore.addProofs(proofsToAdd as Proof[], isPending)
        
        log.trace('[addCashuProofs]', 'Added recovered proofs to the wallet with amount', { amountToAdd, addedAmount, isPending })
    
        return {        
            amountToAdd,
            addedAmount
        }
    }

    // TODO: make it DRY with walletService
    const formatError = function (e: AppError) {
        return {
            name: e.name,
            message: e.message.slice(0, 100),
            params: e.params || {},
        } as AppError 
    }


    const toggleErrorsModal = () => {
        setIsErrorsModalVisible(previousState => !previousState)
    }


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const numIconColor = useThemeColor('textDim')
    const textHint = useThemeColor('textDim')
    const inputBg = useThemeColor('background')

    return (
      <Screen style={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
            <Text preset="heading" text="Wallet recovery" style={{color: 'white', zIndex: 10}} />
            {/*<SvgXml                
                xml={headerBgSvg}
                //width='200%'
                //height='100%'
                //style={{position: 'absolute', bottom: 0, opacity: 1, zIndex: 1}}
                viewBox='40 -80 180 180'       
            />*/}
        </View>

        <View style={$contentContainer}>
            {seedExists ? (
            <Card
                style={$card}
                ContentComponent={
                    <ListItem
                        text='Seed exists'
                        subText='Your wallet already has another seed in its secure storage. Recovery process works only with freshly installed wallet to avoid loss of your funds.'
                        leftIcon='faTriangleExclamation'
                        // leftIconColor='red'                  
                        style={$item}                    
                        bottomSeparator={true}
                    /> 
                }
                FooterComponent={
                    <View style={$buttonContainer}>               
                        <Button
                            onPress={onBack}
                            text='Back'  
                            preset='secondary'                      
                        />                        
                    </View>                    
                }          
            />
            ) : (
                <>
                {isValidSeed ? (
                    <>
                    <Card
                        style={$card}
                        ContentComponent={
                            <ListItem
                                text='Your seed phrase'
                                subText={seed}
                                LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='1'/></View>}                  
                                style={$item}                            
                            /> 
                        }        
                    />
                    <Card
                        style={$card}
                        HeadingComponent={
                            <ListItem
                                text='Recovery from mints'
                                subText='Identify mints to recover your ecash from and add them to the list.'
                                LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='2'/></View>}
                                RightComponent={
                                    <View style={$rightContainer}>
                                        <Button
                                            onPress={onAddMints}
                                            text='Add mints'
                                            preset='secondary'        
                                        /> 
                                    </View>
                                }               
                                style={$item}                            
                            />
                        }
                        ContentComponent={
                            <>
                            {mintsStore.mints.map((mint: Mint, index: number) => (
                                <MintListItem
                                  key={mint.mintUrl}
                                  mint={mint}
                                  mintBalance={proofsStore.getMintBalance(mint.mintUrl)}
                                  // onMintSelect={() => onMintSelect(mint)}
                                  isSelectable={false}
                                  // isSelected={selectedMint?.mintUrl === mint.mintUrl}
                                  // isBlocked={mintsStore.isBlocked(mint.mintUrl as string)}                                  
                                  separator={index === 0 ? 'both' : 'bottom'}
                                />
                              ))}
                            </>
                        }
                        FooterComponent={
                            <>
                            {mintsStore.mintCount > 0 && (
                            <>
                            <View style={$buttonContainer}>               
                                <Button
                                    onPress={doRecovery}
                                    text={startIndex === 0 ? 'Start recovery' : 'Continue recovery'}    
                                />                        
                            </View>
                            <Text 
                                text={`Next interval ${startIndex} - ${endIndex}`} 
                                size='xxs' 
                                style={{color: textHint, alignSelf: 'center', marginTop: spacing.small}}
                            />
                            </>  
                            )}
                            </>   
                        }         
                    />
                    </>
                ) : (
                <Card
                    style={$card}
                    ContentComponent={
                        <ListItem
                            text='Insert backup seed phrase'
                            subText='Paste or rewrite 12 words phrase to recover your ecash balance on this device. Separate words by blank spaces.'
                            LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='1'/></View>}                  
                            style={$item}                            
                        /> 
                    }
                    FooterComponent={
                        <>
                        <TextInput
                            ref={seedInputRef}
                            onChangeText={(seed: string) => setSeed(seed)}
                            value={seed}
                            numberOfLines={3}
                            multiline={true}
                            autoCapitalize='none'
                            keyboardType='default'
                            maxLength={150}
                            placeholder='Seed phrase...'
                            selectTextOnFocus={true}                    
                            style={[$seedInput, {backgroundColor: inputBg, flexWrap: 'wrap'}]}
                        />
                        <View style={$buttonContainer}>
                            {seed ? (
                                <Button
                                    onPress={onConfirm}
                                    text='Confirm'                        
                                />
                            ) : (
                                <Button
                                    onPress={onPaste}
                                    text='Paste'                        
                                />
                            )
                        }                    
                        </View>
                        </>
                    }           
                />
                )}                
            </>
            )}     
            {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isErrorsModalVisible}
          style={{alignItems: 'stretch'}}          
          ContentComponent={
            <>
              {recoveryErrors?.map(err => {
                return(
                    <ListItem
                        leftIcon='faTriangleExclamation'
                        leftIconColor={colors.palette.angry500}                       
                        text={err.message}
                        subText={err.params.mintUrl || ''}
                        bottomSeparator={true}
                        style={{paddingHorizontal: spacing.small}}
                    />             
                )
              })}
            </>
          }
          onBackButtonPress={toggleErrorsModal}
          onBackdropPress={toggleErrorsModal}
        />        
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}      
      </Screen>
    )
})

const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {  
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,  
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

const $seedInput: TextStyle = {
    // flex: 1,    
    borderRadius: spacing.small,    
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.small,
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
