import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState, useCallback} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {
  UIManager,
  Platform,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import {spacing, useThemeColor, colors} from '../theme'
import {WalletStackScreenProps} from '../navigation'
import {
  Button,
  Icon,
  Card,
  Screen,
  Loading,
  InfoModal,
  ErrorModal,
  ListItem,
  BottomModal,
  Text,  
} from '../components'
import {Mint} from '../models/Mint'
import {Transaction, TransactionStatus} from '../models/Transaction'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {MintClient, Wallet} from '../services'
import {log} from '../utils/logger'
import AppError, {Err} from '../utils/AppError'
import {
  decodeInvoice,
  DecodedLightningInvoice,
  getInvoiceData,
} from '../services/cashuHelpers'
import {MintBalance} from '../models/Mint'
import {MintListItem} from './Mints/MintListItem'
import {ResultModalInfo} from './Wallet/ResultModalInfo'

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const TransferScreen: FC<WalletStackScreenProps<'Transfer'>> = observer(
  function TransferScreen({route, navigation}) {

  useHeader({
    leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {proofsStore, mintsStore} = useStores()


  const [encodedInvoice, setEncodedInvoice] = useState<string>('')
    const [invoice, setInvoice] = useState<DecodedLightningInvoice | undefined>()
    const [amountToTransfer, setAmountToTransfer] = useState<number>(0)
    const [estimatedFee, setEstimatedFee] = useState<number>(0)
    const [finalFee, setFinalFee] = useState<number>(0)
    const [memo, setMemo] = useState('')
    const [availableMintBalances, setAvailableMintBalances] = useState<
      MintBalance[]
    >([])
    const [mintBalanceToTransferFrom, setMintBalanceToTransferFrom] = useState<
      MintBalance | undefined
    >()
    const [transactionStatus, setTransactionStatus] = useState<
      TransactionStatus | undefined
    >()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isPasteInvoiceModalVisible, setIsPasteInvoiceModalVisible] =
      useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; message: string} | undefined
    >()


  useFocusEffect(
      useCallback(() => {
        if (!route.params?.scannedEncodedInvoice) {
            log.trace('nothing scanned')
            return
        }
        const encoded = route.params?.scannedEncodedInvoice
        onEncodedInvoice(encoded)
      }, [route.params?.scannedEncodedInvoice]),
    )


  useEffect(() => {
      const getEstimatedFee = async function () {
        try {
          if (!mintBalanceToTransferFrom) return
          const fee = await MintClient.getLightningFee(
            mintBalanceToTransferFrom.mint,
            encodedInvoice,
          )

          if (amountToTransfer + fee > mintBalanceToTransferFrom.balance) {
            setInfo(
              'There is not enough funds to cover expected lightning network fee. Try to select another mint with higher balance.',
            )
          }

          setEstimatedFee(fee)
        } catch (e: any) {
          resetState()
          handleError(e)
        }
      }
      getEstimatedFee()
    }, [mintBalanceToTransferFrom])

    const resetState = function () {
      setEncodedInvoice('')
      setInvoice(undefined)
      setAmountToTransfer(0)
      setEstimatedFee(0)
      setMemo('')
      setAvailableMintBalances([])
      setMintBalanceToTransferFrom(undefined)
      setTransactionStatus(undefined)
      setInfo('')
      setError(undefined)
      setIsLoading(false)
      setIsPasteInvoiceModalVisible(false)
      setIsResultModalVisible(false)
      setResultModalInfo(undefined)
    }

    const gotoScan = function () {
      navigation.navigate('Scan')
    }

    const togglePasteInvoiceModal = () =>
      setIsPasteInvoiceModalVisible(previousState => !previousState)
    const toggleResultModal = () =>
      setIsResultModalVisible(previousState => !previousState)


  const onMintBalanceSelect = function (balance: MintBalance) {
      setMintBalanceToTransferFrom(balance) // this triggers effect to get estimated fees
    }

    const onPasteInvoice = async function () {
      const encoded = await Clipboard.getString()
      if (!encoded) {
        setInfo('Copy received invoice first, then paste')
        return
      }
      togglePasteInvoiceModal()
      return onEncodedInvoice(encoded)
    }

    const onEncodedInvoice = async function (encoded: string) {
      try {
        navigation.setParams({scannedEncodedInvoice: undefined}) 
        setEncodedInvoice(encoded)        

        const invoice = decodeInvoice(encoded)
        const {amount, expiry, description} = getInvoiceData(invoice)

        log.trace('Decoded invoice', invoice)
        log.trace('Invoice data', {amount, expiry, description})

        if (!amount || amount === 0) {
          setInfo('Invoice amount should be positive number')
          return
        }

        const availableBalances =
          proofsStore.getMintBalancesWithEnoughBalance(amount)

        if (availableBalances.length === 0) {
          setInfo('There is not enough funds to send this amount')
          return
        }

        setInvoice(invoice)
        setAmountToTransfer(amount)
        // TODO expiry check or countdown
        if (description) {setMemo(description)}

        log.trace('availableBalances', availableBalances.length)

        setAvailableMintBalances(availableBalances)
        setMintBalanceToTransferFrom(availableBalances[0])
      } catch (e: any) {
        resetState()
        handleError(e)
      }
    }

    const transfer = async function () {
      setIsLoading(true)

      const {transaction, message, error, finalFee} = await Wallet.transfer(
        mintBalanceToTransferFrom as MintBalance,
        amountToTransfer,
        estimatedFee,
        memo,
        encodedInvoice,
      )

      const {status} = transaction as Transaction
      setTransactionStatus(status)

      if (error) {
        setResultModalInfo({
          status,
          message: error.message,
        })
      } else {
        setResultModalInfo({
          status,
          message,
        })
      }

      if (finalFee) {
        setFinalFee(finalFee)
      }

      setIsLoading(false)
      toggleResultModal()
    }


  const handleError = function(e: AppError): void {
    setIsLoading(false)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const feeColor = colors.palette.primary200

    return (
        <Screen preset="auto" contentContainerStyle={$screen}>
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>
                {invoice && amountToTransfer > 0 ? (
                <View style={$amountContainer}>
                    <Text
                        preset="subheading"
                        text="Amount to transfer (sats)"
                        style={{color: 'white'}}
                    />
                    <Text
                        style={$amountToTransfer}
                        text={amountToTransfer.toLocaleString()}
                    />
                    {transactionStatus === TransactionStatus.COMPLETED ? (
                    <Text
                        style={{color: feeColor}}
                        text={`+ final fee ${estimatedFee.toLocaleString()} sats`}
                    />
                    ) : (
                    <Text
                        style={{color: feeColor}}
                        text={`+ estimated fee ${finalFee.toLocaleString()} sats`}
                    />
                    )}
                </View>
                ) : (
                    <Text preset="heading" text="Transfer" style={{color: 'white'}} />
                )}
            </View>
            <View style={$contentContainer}>
                {!resultModalInfo && !mintBalanceToTransferFrom && (
                    <Card
                        style={$optionsCard}
                        ContentComponent={
                            <>
                                <ListItem
                                    tx="transferScreen.pasteLightningInvoice"
                                    subTx="transferScreen.pasteLightningInvoiceDescription"
                                    leftIcon='faBolt'
                                    leftIconColor={colors.palette.secondary300}
                                    leftIconInverse={true}
                                    style={$item}
                                    bottomSeparator={true}
                                    onPress={togglePasteInvoiceModal}
                                />
                                <ListItem
                                    tx="transferScreen.scanLightningInvoice"
                                    subTx="transferScreen.scanLightningInvoiceDescription"
                                    leftIcon='faQrcode'
                                    leftIconColor={colors.palette.success200}
                                    leftIconInverse={true}
                                    style={$item}
                                    bottomSeparator={false}
                                    onPress={gotoScan}
                                />
                            </>
                        }
                    />
                )}

                {mintBalanceToTransferFrom &&
                    availableMintBalances.length > 0 &&
                    transactionStatus !== TransactionStatus.COMPLETED && (
                    <MintBalanceSelector
                        availableMintBalances={availableMintBalances}
                        mintBalanceToSendFrom={mintBalanceToTransferFrom as MintBalance}
                        onMintBalanceSelect={onMintBalanceSelect}
                        onCancel={resetState}
                        findByUrl={mintsStore.findByUrl}
                        onMintBalanceConfirm={transfer}
                    />
                )}
                {transactionStatus === TransactionStatus.COMPLETED && (
                    <>
                    <Card
                        style={$card}
                        ContentComponent={
                        <MintListItem
                            mint={
                            mintsStore.findByUrl(
                                mintBalanceToTransferFrom?.mint as string,
                            ) as Mint
                            }
                            isSelectable={false}
                            mintBalance={proofsStore
                            .getBalances()
                            .mintBalances.find(
                                balance =>
                                balance.mint === mintBalanceToTransferFrom?.mint,
                            )}
                            separator={undefined}
                        />
                        }
                    />
                    <View style={$buttonContainer}>
                        <Button
                            preset="secondary"
                            tx={'common.close'}
                            onPress={resetState}
                        />
                    </View>
                    </>
                )}
                {isLoading && <Loading />}
            </View>
            <BottomModal
                isVisible={isPasteInvoiceModalVisible ? true : false}
                top={spacing.screenHeight * 0.6}
                style={{marginHorizontal: spacing.extraSmall}}
                ContentComponent={
                    <PasteInvoiceBlock
                        togglePasteModal={togglePasteInvoiceModal}
                        onPasteInvoice={onPasteInvoice}
                    />
                }
                onBackButtonPress={togglePasteInvoiceModal}
                onBackdropPress={togglePasteInvoiceModal}
            />
            <BottomModal
                isVisible={isResultModalVisible ? true : false}
                top={spacing.screenHeight * 0.6}                
                ContentComponent={
                    <>
                        {resultModalInfo &&
                            transactionStatus === TransactionStatus.COMPLETED && (
                            <>
                                <ResultModalInfo
                                    icon="faCheckCircle"
                                    iconColor={colors.palette.success200}
                                    title="Transfer completed"
                                    message={resultModalInfo?.message}
                                />
                                <View style={$buttonContainer}>
                                <Button
                                    preset="secondary"
                                    tx={'common.close'}
                                    onPress={() => navigation.navigate('Wallet', {})}
                                />
                                </View>
                            </>
                        )}
                        {resultModalInfo && transactionStatus === TransactionStatus.REVERTED && (
                            <>
                                <ResultModalInfo
                                    icon="faRotate"
                                    iconColor={colors.palette.accent300}
                                    title="Transfer reverted"
                                    message={resultModalInfo?.message}
                                />
                                <View style={$buttonContainer}>
                                <Button
                                    preset="secondary"
                                    tx={'common.close'}
                                    onPress={toggleResultModal}
                                />
                                </View>
                            </>
                        )}               
                        {resultModalInfo &&
                            transactionStatus === TransactionStatus.ERROR && (
                            <>
                                <ResultModalInfo
                                icon="faTriangleExclamation"
                                iconColor={colors.palette.angry500}
                                title="Transfer failed"
                                message={resultModalInfo?.message}
                                />
                                <View style={$buttonContainer}>
                                <Button
                                    preset="secondary"
                                    tx={'common.close'}
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
        </Screen>
    )
  }
)

const PasteInvoiceBlock = function (props: {
    togglePasteModal: any
    onPasteInvoice: any
}) {
  return (
    <View style={$bottomModal}>
        <View style={$buttonContainer}>
        <Button
            tx={'common.paste'}
            onPress={() => props.onPasteInvoice()}
            style={{marginRight: spacing.medium}}
        />
        <Button
            preset="secondary"
            tx={'common.cancel'}
            onPress={props.togglePasteModal}
        />
        </View>
    </View>
  )
}

const MintBalanceSelector = observer(function (props: {
  availableMintBalances: MintBalance[]
  mintBalanceToSendFrom: MintBalance
  onMintBalanceSelect: any
  onCancel: any
  findByUrl: any
  onMintBalanceConfirm: any
}) {

    const onMintSelect = function(balance: MintBalance) {
    log.trace('onMintBalanceSelect', balance.mint)
    return props.onMintBalanceSelect(balance)
  }

  return (
    <>
      <Card
        style={$card}
        heading={'Pay from'}
        headingStyle={{textAlign: 'center', padding: spacing.small}}
        ContentComponent={
          <>
            {props.availableMintBalances.map(
              (balance: MintBalance, index: number) => (
                <MintListItem
                  key={balance.mint}
                  mint={props.findByUrl(balance.mint)}
                  mintBalance={balance}
                  onMintSelect={() => onMintSelect(balance)}
                  isSelectable={true}
                  isSelected={props.mintBalanceToSendFrom.mint === balance.mint}
                  separator={'top'}
                />
              ),
            )}
          </>
        }
      />
      <View style={[$buttonContainer, {marginTop: spacing.large}]}>
        <Button
          text="Transfer now"
          onPress={props.onMintBalanceConfirm}
          style={{marginRight: spacing.medium}}
          // LeftAccessory={() => <Icon icon="faCoins" color="white" size={spacing.medium} containerStyle={{marginRight: spacing.small}}/>}
        />
        <Button
          preset="secondary"
          tx={'common.cancel'}
          onPress={props.onCancel}
        />
      </View>
    </>
  )
})

const $screen: ViewStyle = {
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  paddingTop: 0,
  height: spacing.screenHeight * 0.18,
}

const $amountContainer: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
}

const $amountToTransfer: TextStyle = {
  flex: 1,
  paddingTop: spacing.extraLarge + 10,
  fontSize: 52,
  fontWeight: '400',
  textAlignVertical: 'center',
  color: 'white',
}

const $contentContainer: TextStyle = {
  padding: spacing.extraSmall,
}

const $optionsCard: ViewStyle = {
  marginTop: -spacing.extraLarge * 2,
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $bottomModal: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  paddingHorizontal: spacing.small,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}

const $receiveMsg: ViewStyle = {
  flexDirection: 'row',
  borderRadius: spacing.large,
  justifyContent: 'flex-start',
  padding: spacing.small,
}

