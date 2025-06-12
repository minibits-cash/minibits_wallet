import {formatDistance} from 'date-fns/formatDistance'
import {observer} from 'mobx-react-lite'
import React from 'react'
import {Image, TextStyle, View, ViewStyle} from 'react-native'
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
import { NostrProfile, log } from '../../services'
import { moderateScale, verticalScale } from '@gocodingnow/rn-size-matters'
import { useNavigation } from '@react-navigation/native'
import { getActiveRouteName } from '../../navigation'
import FastImage from 'react-native-fast-image'

export interface TransactionListProps {
  transaction: Transaction
  isFirst: boolean
  isTimeAgoVisible: boolean  
}

export const TransactionListItem = observer(function (props: TransactionListProps) {
  const navigation = useNavigation()
  const {transaction: tx, isTimeAgoVisible} = props

  const txReceiveColor = useThemeColor('receivedAmount')
  const txSendColor = useThemeColor('amount')
  const txErrorColor = useThemeColor('textDim')
  const txPendingColor = useThemeColor('textDim')
  const isInternetReachable = useIsInternetReachable()

  const onPress = function() {
    const currentScreen = getActiveRouteName(navigation.getState()!)
    log.trace('[onPress]', {currentScreen})
    // @ts-ignore
    navigation.navigate('TransactionsNavigator', {screen: 'TranDetail', params: {id: tx.id, prevScreen: currentScreen}})
  }  

  const getProfileName = function(profileString: string): string {
    try {
      const maybeProfile: NostrProfile = JSON.parse(profileString)
      return maybeProfile.nip05 ?? maybeProfile.name      
    } catch (e: any) {
      return profileString 
    }
  }  

  const getText = function (tx: Transaction) {
    if (tx.noteToSelf) return tx.noteToSelf    

    switch (tx.type) {
      case TransactionType.RECEIVE:
        if (tx.sentFrom) {
          if (!tx.memo || tx.memo.includes('Sent from Minibits')) {
            return translate('transactionCommon.from', {sender: getProfileName(tx.sentFrom)})
          }
        } else {
          return tx.memo ? tx.memo : translate('transactionCommon.youReceived')
        }
      case TransactionType.RECEIVE_BY_PAYMENT_REQUEST:
        if (tx.sentFrom) {
          if (!tx.memo || tx.memo.includes('Sent from Minibits')) {
            return translate('transactionCommon.from', {sender: getProfileName(tx.sentFrom)})
          }
        } else {
          return tx.memo ? tx.memo : translate('transactionCommon.youReceived')
        }
      case TransactionType.RECEIVE_OFFLINE:
        if (tx.sentFrom) {
          if (!tx.memo || tx.memo.includes('Sent from Minibits')) {
            return translate('transactionCommon.from', {sender: getProfileName(tx.sentFrom)})
          }
        } else {
          return tx.memo ? tx.memo : translate('transactionCommon.youReceived')
        }
      case TransactionType.SEND:
        return (tx.memo
          ? tx.memo
          : tx.sentTo
          ? translate('transactionCommon.sentTo', {receiver: getProfileName(tx.sentTo)})
          : translate('transactionCommon.youSent'))
      case TransactionType.TOPUP:
        return (tx.memo
          ? tx.memo
          : tx.sentFrom
          ? translate('transactionCommon.receivedFrom', {sender: getProfileName(tx.sentFrom)})
          : translate('transactionCommon.youReceived'))
      case TransactionType.TRANSFER:
        return (tx.memo && tx.memo !== 'LNbits'
          ? tx.memo
          : tx.sentTo
          ? translate('transactionCommon.paidTo', {receiver: getProfileName(tx.sentTo)})
          : translate('transactionCommon.youPaid'))        
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
        if(tx.fee && tx.fee > 0) {
          if(isTimeAgoVisible) {
            return timeAgo + 'Fee ' + tx.fee
          } else {
            return 'Fee ' + tx.fee
          }
            
        } else {
          if(isTimeAgoVisible) {
            return distance
          } else {
            return translate('transactionCommon.status.completed')
          }
        }
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
      if([TransactionStatus.ERROR, TransactionStatus.EXPIRED, TransactionStatus.BLOCKED].includes(tx.status)) {
        return (<Icon containerStyle={$txIconContainer} icon="faBan" size={spacing.medium} color={txErrorColor}/>)
      }

      if([TransactionStatus.REVERTED].includes(tx.status)) {
        return (<Icon containerStyle={$txIconContainer} icon="faArrowRotateLeft" size={spacing.medium} color={txErrorColor}/>)
      }

      if([TransactionStatus.PENDING].includes(tx.status)) {
        return (<Icon containerStyle={$txIconContainer} icon="faClock" size={spacing.medium} color={txErrorColor}/>)
      }
  
      if([TransactionType.RECEIVE, TransactionType.TOPUP, TransactionType.RECEIVE_BY_PAYMENT_REQUEST].includes(tx.type)) {
        if(tx.profile) {
          const profilePicture = getProfilePicture(tx.profile)
          if(profilePicture) {
            return profilePicture
          }
        }
        return (<Icon containerStyle={$txIconContainer} icon="faArrowTurnDown" size={spacing.medium} color={txReceiveColor}/>)
      }

      if([TransactionType.RECEIVE_OFFLINE].includes(tx.type)) {
          return (<Icon containerStyle={$txIconContainer} icon="faArrowTurnDown" size={spacing.medium} color={txPendingColor}/>)        
      }

      if([TransactionType.SEND, TransactionType.TRANSFER].includes(tx.type)) {
        if(tx.profile) {
          const profilePicture = getProfilePicture(tx.profile)
          if(profilePicture) {
            return profilePicture
          }
        }
      }

      return (<Icon containerStyle={$txIconContainer} icon="faArrowTurnUp" size={spacing.medium} color={txSendColor}/>)
    }


    const getProfilePicture = function(profileString: string): React.ReactElement | undefined {
      try {
        const profile: NostrProfile = JSON.parse(profileString)

        if(profile && profile.picture) {
          return (
            <View style={$pictureContainer}>
              {profile.picture ? (
                <FastImage 
                  style={
                    {
                      width: verticalScale(34),
                      height: verticalScale(34),
                      borderRadius: verticalScale(34) / 2,
                    }
                  } 
                  source={{uri: profile.picture}}
                  // defaultSource={require('../../../assets/icons/nostr.png')}
                /> 
              ) : (
                <FastImage 
                  style={
                    {
                      width: verticalScale(34),
                      height: verticalScale(34),
                      borderRadius: verticalScale(34) / 2,
                    }
                  } 
                  source={require('../../../assets/icons/nostr.png')}                  
                />
              )}               
            </View>  
          )
        } 
      } catch (e: any) {}
      
      return undefined      
    }
  
  
    return (
      <ListItem
        key={tx.id}                      
        text={getText(tx)}        
        textStyle={$mintText}
        subText={getSubText(tx)}
        subTextEllipsizeMode='tail'
        textEllipsizeMode='tail'
        LeftComponent={getLeftIcon(tx)}  
        RightComponent={
          <View style={$txContainer}>
            {([TransactionType.RECEIVE, TransactionType.RECEIVE_OFFLINE, TransactionType.RECEIVE_BY_PAYMENT_REQUEST].includes(tx.type)) && (
                <>
                {[TransactionStatus.COMPLETED].includes(tx.status) && (
                    <CurrencyAmount 
                          amount={tx.amount}
                          mintUnit={tx.unit}
                          size='medium'
                          amountStyle={{color: txReceiveColor}}
                    />
                )}
                {[TransactionStatus.ERROR, TransactionStatus.BLOCKED, TransactionStatus.PREPARED_OFFLINE, TransactionStatus.EXPIRED].includes(tx.status) && (
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
        onPress={onPress}
      />
    )

})

const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}

const $mintText: TextStyle = {
  overflow: 'hidden',
  fontSize: verticalScale(14),
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

const $pictureContainer: ViewStyle = {
  flex: 0,
  // borderRadius: spacing.small,
  // padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.small,
}
