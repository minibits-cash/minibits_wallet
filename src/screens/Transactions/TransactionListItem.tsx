import {formatDistance} from 'date-fns/formatDistance'
import {observer} from 'mobx-react-lite'
import React from 'react'
import {TextStyle, View, ViewStyle} from 'react-native'
import {Icon, ListItem} from '../../components'
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction'
import {colors, spacing, typography, useThemeColor} from '../../theme'
import useIsInternetReachable from '../../utils/useIsInternetReachable'
import {translate} from '../../i18n'
import { CurrencyAmount } from '../Wallet/CurrencyAmount'

export interface TransactionListProps {
  transaction: Transaction
  isFirst: boolean
  isTimeAgoVisible: boolean
  gotoTranDetail: any
}

export const TransactionListItem = observer(function (
  props: TransactionListProps,
) {
  const {transaction: tx, isTimeAgoVisible} = props

  const txReceiveColor = useThemeColor('receivedAmount')
  const txSendColor = useThemeColor('amount')
  const txErrorColor = useThemeColor('textDim')
  const txPendingColor = useThemeColor('textDim')
  const isInternetReachable = useIsInternetReachable()

  const getText = function (tx: Transaction) {
    if (tx.noteToSelf) return tx.noteToSelf
    // if(tx.memo) return tx.memo

    switch (tx.type) {
      case TransactionType.RECEIVE || TransactionType.RECEIVE_OFFLINE:
        if (tx.sentFrom) {
          if (!tx.memo || tx.memo.includes('Sent from Minibits')) {
            return translate('transactionCommon.from', {sender: tx.sentFrom}).slice(0, 30)
          }
        } else {
          return tx.memo ? tx.memo : translate('transactionCommon.youReceived')
        }
      case TransactionType.SEND:
        return (tx.memo
          ? tx.memo
          : tx.sentTo
          ? translate('transactionCommon.sentTo', {receiver: tx.sentTo})
          : translate('transactionCommon.youSent')).slice(0, 30)
      case TransactionType.TOPUP:
        return (tx.memo
          ? tx.memo
          : tx.sentFrom
          ? translate('transactionCommon.receivedFrom', {sender: tx.sentFrom})
          : translate('transactionCommon.youReceived')).slice(0, 30)
      case TransactionType.TRANSFER:
        return (tx.memo
          ? tx.memo
          : tx.sentTo
          ? translate('transactionCommon.paidTo', {receiver: tx.sentTo})
          : translate('transactionCommon.youPaid')).slice(0, 30)
      default:
        return translate('transactionCommon.unknown')
    }
  }

  const getSubText = function (tx: Transaction) {
    let distance = formatDistance(tx.createdAt as Date, new Date(), {
      addSuffix: true,
    })
    let timeAgo = ''
    if (isTimeAgoVisible) timeAgo = `${distance} · `

    switch (tx.status) {
      case TransactionStatus.COMPLETED:
        return (
          timeAgo +
          translate('transactionCommon.status.completedFee', {
            fee: (tx.fee && tx.fee > 0) ? ' · Fee ' + tx.fee : '',
          })
        )
      case TransactionStatus.DRAFT:
        return timeAgo + translate('transactionCommon.status.draft')
      case TransactionStatus.ERROR:
        return timeAgo + translate('transactionCommon.status.error')
      case TransactionStatus.PENDING:
        return timeAgo + translate('transactionCommon.status.pending')
      case TransactionStatus.PREPARED:
        return timeAgo + translate('transactionCommon.status.prepared')
      case TransactionStatus.PREPARED_OFFLINE:
        if (isInternetReachable) {
          return timeAgo + translate('transactionCommon.tapToRedeem')
        } else {
          return timeAgo + translate('transactionCommon.redeemOnline')
        }
      case TransactionStatus.REVERTED:
        return timeAgo + translate('transactionCommon.status.reverted')
      case TransactionStatus.BLOCKED:
        return timeAgo + translate('transactionCommon.status.blocked')
      case TransactionStatus.EXPIRED:
        return timeAgo + translate('transactionCommon.status.expired')
      default:
        return timeAgo
    }
  }


    const getLeftIcon = function(tx: Transaction) {
      if([TransactionStatus.ERROR, TransactionStatus.EXPIRED, TransactionStatus.BLOCKED, TransactionStatus.REVERTED].includes(tx.status)) {
        return (<Icon containerStyle={$txIconContainer} icon="faBan" size={spacing.medium} color={txErrorColor}/>)
      }

      if([TransactionStatus.PENDING].includes(tx.status)) {
        return (<Icon containerStyle={$txIconContainer} icon="faClock" size={spacing.medium} color={txErrorColor}/>)
      }

      /* if([TransactionType.TOPUP].includes(tx.type) && tx.status === TransactionStatus.PENDING) {
        return (<Icon containerStyle={$txIconContainer} icon="faArrowTurnDown" size={spacing.medium} color={txPendingColor}/>)
      } */
  
      if([TransactionType.RECEIVE, TransactionType.TOPUP].includes(tx.type)) {
        return (<Icon containerStyle={$txIconContainer} icon="faArrowTurnDown" size={spacing.medium} color={txReceiveColor}/>)
      }

      if([TransactionType.RECEIVE_OFFLINE].includes(tx.type)) {
        return (<Icon containerStyle={$txIconContainer} icon="faArrowTurnDown" size={spacing.medium} color={txPendingColor}/>)
      }

      return (<Icon containerStyle={$txIconContainer} icon="faArrowTurnUp" size={spacing.medium} color={txSendColor}/>)
    }

    
  
    return (
      <ListItem
        key={tx.id}                      
        text={getText(tx)}        
        textStyle={$mintText}
        subText={getSubText(tx)}        
        LeftComponent={getLeftIcon(tx)}  
        RightComponent={
          <View style={$txContainer}>
            {([TransactionType.RECEIVE, TransactionType.RECEIVE_OFFLINE].includes(tx.type)) && (
                <>
                {[TransactionStatus.COMPLETED].includes(tx.status) && (
                    <CurrencyAmount 
                          amount={tx.amount}
                          mintUnit={tx.unit}
                          size='medium'
                          amountStyle={{color: txReceiveColor}}
                    />
                )}
                {[TransactionStatus.ERROR, TransactionStatus.BLOCKED, TransactionStatus.PREPARED_OFFLINE].includes(tx.status) && (
                    <CurrencyAmount 
                          amount={tx.amount}
                          mintUnit={tx.unit}
                          size='medium'
                          amountStyle={{color: txErrorColor}}
                    />                    
                )}                
                </>              
            )}
            {([TransactionType.TOPUP].includes(tx.type)) && (
                <>
                {[TransactionStatus.PENDING, TransactionStatus.EXPIRED].includes(tx.status) && (
                    <CurrencyAmount 
                          amount={tx.amount}
                          mintUnit={tx.unit}
                          size='medium'
                          amountStyle={{color: txPendingColor}}
                    />                    
                )}
                {tx.status === TransactionStatus.COMPLETED && (
                    <CurrencyAmount 
                          amount={tx.amount}
                          mintUnit={tx.unit}
                          size='medium'
                          amountStyle={{color: txReceiveColor}}
                    />
                )}
                {tx.status === TransactionStatus.ERROR && (
                    <CurrencyAmount 
                          amount={tx.amount}
                          mintUnit={tx.unit}
                          size='medium'
                          amountStyle={{color: txErrorColor}}
                    />                    
                )}                
                </>
            )}
            {([TransactionType.SEND, TransactionType.TRANSFER].includes(tx.type)) && (
                    <CurrencyAmount 
                          amount={-1 * tx.amount}
                          mintUnit={tx.unit}
                          size='medium'
                          amountStyle={{color: (tx.status === TransactionStatus.ERROR) ? txErrorColor : txSendColor}}
                    />
            )}
          </View>
        }          
        topSeparator={props.isFirst ? false : true}
        style={$item}
        onPress={() => props.gotoTranDetail(tx.id)}
      />
    )

})

const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}

const $mintText: TextStyle = {
  overflow: 'hidden',
  fontSize: 14,
}

const $txContainer: ViewStyle = {
  justifyContent: 'center',
  alignSelf: 'center',
  marginRight: spacing.extraSmall,
}

const $txAmount: TextStyle = {
  fontFamily: typography.primary?.medium,
}

const $txIconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}
