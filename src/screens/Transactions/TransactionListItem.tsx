import formatDistance from "date-fns/formatDistance"
import { observer } from "mobx-react-lite"
import React from "react"
import { ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { Button, Icon, ListItem, Screen, Text } from "../../components"
import { Transaction, TransactionStatus, TransactionType } from "../../models/Transaction"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import useIsInternetReachable from "../../utils/useIsInternetReachable"
import { translate } from "../../i18n"

export interface TransactionListProps {
  transaction: Transaction,
  isFirst: boolean,
  isTimeAgoVisible: boolean,
  gotoTranDetail: any,
}

export const TransactionListItem = observer(function (props: TransactionListProps) {
  
    const { transaction: tx, isTimeAgoVisible } = props
  
    const txReceiveColor = colors.palette.success300
    const txSendColor = useThemeColor('amount')
    const txErrorColor = useThemeColor('textDim')    
    const txPendingColor = useThemeColor('textDim')
    const isInternetReachable = useIsInternetReachable()
  
    const getText = function(tx: Transaction) {
      if (tx.noteToSelf) return tx.noteToSelf
      // if(tx.memo) return tx.memo

      switch (tx.type) {
        case TransactionType.RECEIVE || TransactionType.RECEIVE_OFFLINE:
          if (tx.sentFrom) {
            if (!tx.memo || tx.memo.includes('Sent from Minibits')) {
              return translate('transactionCommon.from', {sender: tx.sentFrom})
            }
          } else {
            return tx.memo
              ? tx.memo
              : translate('transactionCommon.youReceived')
          }
        case TransactionType.SEND:
          return tx.memo
            ? tx.memo
            : tx.sentTo
            ? translate('transactionCommon.sentTo', {receiver: tx.sentTo})
            : translate('transactionCommon.youSent')
        case TransactionType.TOPUP:
          return tx.memo
            ? tx.memo
            : tx.sentFrom
            ? translate("transactionCommon.receivedFrom", {sender: tx.sentFrom})
            : translate("transactionCommon.youReceived")
        case TransactionType.TRANSFER:
          return tx.memo
            ? tx.memo
            : tx.sentTo
            ? translate('transactionCommon.paidTo', {receiver: tx.sentTo})
            : translate("transactionCommon.youPaid")
        default:
          return translate("transactionCommon.unknown")
      }
    }
  
  
    const getSubText = function(tx: Transaction) {
  
      let distance = formatDistance(tx.createdAt as Date, new Date(), {addSuffix: true})
      let timeAgo = ''
      if (isTimeAgoVisible) timeAgo = `${distance} · `
  
      switch(tx.status) {
        case TransactionStatus.COMPLETED:
          return timeAgo + `Completed ${(tx.fee && tx.fee > 0) ? ' · Fee ' + tx.fee : ''}`
        case TransactionStatus.DRAFT:
          return timeAgo + `Draft`
        case TransactionStatus.ERROR:
          return timeAgo + `Error`
        case TransactionStatus.PENDING:
          return timeAgo + `Pending`
        case TransactionStatus.PREPARED:
          return timeAgo + `Prepared`   
        case TransactionStatus.PREPARED_OFFLINE:
            if(isInternetReachable) {
                return timeAgo + `Tap to redeem`  
            } else {
                return timeAgo + `Redeem online`  
            }            
        case TransactionStatus.REVERTED:
            return timeAgo + `Reverted` 
        case TransactionStatus.BLOCKED:
            return timeAgo + `Blocked` 
        case TransactionStatus.EXPIRED:
            return timeAgo + `Expired`       
        default:
          return timeAgo
      }
    }


    const getLeftIcon = function(tx: Transaction) {
      if([TransactionStatus.ERROR, TransactionStatus.EXPIRED, TransactionStatus.BLOCKED].includes(tx.status)) {
        return (<Icon containerStyle={$txIconContainer} icon="faBan" size={spacing.medium} color={txErrorColor}/>)
      }

      if([TransactionType.TOPUP].includes(tx.type) && tx.status === TransactionStatus.PENDING) {
        return (<Icon containerStyle={$txIconContainer} icon="faArrowTurnDown" size={spacing.medium} color={txPendingColor}/>)
      }
  
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
                    <Text style={[$txAmount, {color: txReceiveColor}]}>{tx.amount.toLocaleString()}</Text>
                )}
                {[TransactionStatus.ERROR, TransactionStatus.BLOCKED, TransactionStatus.PREPARED_OFFLINE].includes(tx.status) && (
                    <Text style={[$txAmount, {color: txErrorColor}]}>{tx.amount.toLocaleString()}</Text>
                )}                
                </>              
            )}
            {([TransactionType.TOPUP].includes(tx.type)) && (
                <>
                {[TransactionStatus.PENDING, TransactionStatus.EXPIRED].includes(tx.status) && (
                    <Text style={[$txAmount, {color: txPendingColor}]}>{tx.amount.toLocaleString()}</Text>
                )}
                {tx.status === TransactionStatus.COMPLETED && (
                    <Text style={[$txAmount, {color: txReceiveColor}]}>{tx.amount.toLocaleString()}</Text>
                )}
                {tx.status === TransactionStatus.ERROR && (
                    <Text style={[$txAmount, {color: txErrorColor}]}>{tx.amount.toLocaleString()}</Text>
                )}                
                </>
            )}
            {([TransactionType.SEND, TransactionType.TRANSFER].includes(tx.type)) && (
              <Text style={[$txAmount, {color: (tx.status === TransactionStatus.ERROR) ? txErrorColor : txSendColor}]}>-{tx.amount.toLocaleString()}</Text>
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
    marginRight: spacing.extraSmall
  }
  
  const $txAmount: TextStyle = {  
    fontFamily: typography.primary?.medium
  }
  
  const $txIconContainer: ViewStyle = {
    padding: spacing.extraSmall,
    alignSelf: "center",
    marginRight: spacing.medium,
  }
