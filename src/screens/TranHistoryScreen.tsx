import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {  
  TextStyle,
  ViewStyle,
  View,
  FlatList,
  SectionList,
  Platform,
  UIManager,
  LayoutAnimation,
} from 'react-native'
import {formatDistance, toDate} from 'date-fns'
import {useThemeColor, spacing, colors, typography} from '../theme'
import {
  Button,
  Icon,
  Screen,
  Text,
  Card,
  ListItem,
  ErrorModal,
  InfoModal,
  Loading,
  BottomModal,
} from '../components'
import {TransactionsStackScreenProps} from '../navigation'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {Database, log} from '../services'
import AppError from '../utils/AppError'
import {TransactionListItem} from './Transactions/TransactionListItem'
import { Transaction, TransactionStatus } from '../models/Transaction'
import { height } from '@fortawesome/free-solid-svg-icons/faWallet'
import { translate } from '../i18n'
import { maxTransactionsInHistory } from '../models/TransactionsStore'

if (Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}
// Number of transactions held in TransactionsStore model
const limit = maxTransactionsInHistory

export const TranHistoryScreen: FC<TransactionsStackScreenProps<'TranHistory'>> = observer(function TranHistoryScreen(_props) {
    const {navigation} = _props
    const {transactionsStore, mintsStore} = useStores()
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
      rightIcon: 'faEllipsisVertical',
      onRightPress: () => toggleDeleteModal()
    })

    const [showPendingOnly, setShowPendingOnly] = useState<boolean>(false)
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isHeaderVisible, setIsHeaderVisible] = useState(true)
    const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false)
    const [totalDbCount, setTotalDbCount] = useState<number>(0)
    const [pendingDbCount, setPendingDbCount] = useState<number>(0)
    const [expiredDbCount, setExpiredDbCount] = useState<number>(0)
    const [erroredDbCount, setErroredDbCount] = useState<number>(0)
    const [revertedDbCount, setRevertedDbCount] = useState<number>(0)
    const [isAll, setIsAll] = useState<boolean>(false)
    const [pendingIsAll, setPendingIsAll] = useState<boolean>(false)

    useEffect(() => {
        const init = async () => {     
            setIsLoading(true)
            const countByStatus = Database.getTransactionsCount()            
            
            log.trace('Database transaction counts', {countByStatus})
            
            setPendingDbCount(countByStatus[TransactionStatus.PENDING] || 0)
            setExpiredDbCount(countByStatus[TransactionStatus.EXPIRED] || 0)
            setErroredDbCount(countByStatus[TransactionStatus.ERROR] || 0)
            setRevertedDbCount(countByStatus[TransactionStatus.REVERTED] || 0)
            setTotalDbCount(countByStatus.total)

            // Preload transactions to model in case they are not there
            if(countByStatus.total > 0) {
                if(transactionsStore.historyCount === 0) {
                    transactionsStore.addToHistory(limit, 0, false)                    
                }

                if(transactionsStore.recentByUnit.length === 0) {                    
                    transactionsStore.addRecentByUnit()                    
                }
            }

            setIsLoading(false)

            if (countByStatus.total <= limit) {  
                log.trace('[init] setAll true')          
                setIsAll(true)
            }

            /* if (countByStatus[TransactionStatus.PENDING] <= limit) {  
                log.trace('setPendingAll true')          
                setPendingIsAll(true)
            }*/
        }

        init()
        return () => {
            if(showPendingOnly) {
                // Full clean if filtered, next visit will reload from db
                transactionsStore.removeAllHistory()
            } else {
                // Keep recent in history to load fast on next visit                                
                transactionsStore.pruneHistory() 
            }
            // general cleanup - avoid that tx from deleted mints remain in state forever          
            transactionsStore.pruneRecentWithoutCurrentMint()
        }
    }, [])

    const toggleDeleteModal = () => {
        setIsDeleteModalVisible(previousState => !previousState)
    }

    
    const addTransactionsToList = function () {
        setIsLoading(true)
        try {
            transactionsStore.addToHistory(limit, transactionsStore.historyCount, false)            

            log.trace('[addTransactionsToList]', {
                currentOffset: transactionsStore.historyCount,                
                totalDbCount
            })

            if (transactionsStore.historyCount >= totalDbCount) {
                log.trace('[getTransactionsList] setAll true')
                setIsAll(true)
            }            

            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }   
    

    const addPendingTransactionsToList = function () {
        setIsLoading(true)
        try {
            transactionsStore.addToHistory(limit, transactionsStore.historyCount, true)            

            log.trace('[addTransactionsToList] onlyPending', {
                currentOffset: transactionsStore.historyCount,                
                pendingDbCount
            })

            if (transactionsStore.historyCount >= pendingDbCount) {
                log.trace('[getTransactionsList] onlyPending setAll true')
                setPendingIsAll(true)
            }            

            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }  
    

    const toggleShowPendingOnly = function () {
        if (showPendingOnly) {        
            transactionsStore.removeAllHistory()            
            addTransactionsToList()         
            setShowPendingOnly(false)
        } else {
            transactionsStore.removeAllHistory()            
            addPendingTransactionsToList() // hydrate with onlyPending = true
            setShowPendingOnly(true)
        }
    }

    
    const collapseHeader = function () {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)        
        setIsHeaderVisible(false)
        
    }

    const expandHeader = function () {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
        setIsHeaderVisible(true)
    }

    const gotoTranDetail = function (id: number) {
        navigation.navigate('TranDetail', {id})
    }


    const onDelete = function (status: TransactionStatus) {
        try {
            toggleDeleteModal()
            setIsLoading(true)
            transactionsStore.deleteByStatus(status)            
            const countByStatus = Database.getTransactionsCount()

            setPendingDbCount(countByStatus[TransactionStatus.PENDING] || 0)
            setExpiredDbCount(countByStatus[TransactionStatus.EXPIRED] || 0)
            setErroredDbCount(countByStatus[TransactionStatus.ERROR] || 0)
            setRevertedDbCount(countByStatus[TransactionStatus.REVERTED] || 0)
            setTotalDbCount(countByStatus.total)           
            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }        
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')    
    const activeIconColor = useThemeColor('button')    
    const headerTitle = useThemeColor('headerTitle')

    const sections = showPendingOnly ? Object.keys(transactionsStore.historyPendingByTimeAgo).map((timeAgo) => ({
        title: timeAgo,
        data: transactionsStore.historyPendingByTimeAgo[timeAgo],
    })) : Object.keys(transactionsStore.historyByTimeAgo).map((timeAgo) => ({
        title: timeAgo,
        data: transactionsStore.historyByTimeAgo[timeAgo],
    }))

    return (
      <Screen contentContainerStyle={$screen}>        
        <View style={[isHeaderVisible ? $headerContainer : $headerCollapsed, {backgroundColor: headerBg}]}>
            <Text preset="heading" text="History" style={{color: headerTitle}} />
        </View>
            
        <View style={$contentContainer}>
            <Card
                style={$actionCard}
                ContentComponent={
                    <>
                        <ListItem
                            text={showPendingOnly 
                              ? translate("tranHistory.showingPaginationPending", {
                                amount: transactionsStore.pendingHistoryCount,
                                total: pendingDbCount
                              }) 
                              : translate("tranHistory.showingPaginationTotal", {
                                amount: transactionsStore.historyCount,
                                total: totalDbCount
                              })
                            }
                            LeftComponent={
                                <Icon
                                containerStyle={$iconContainer}
                                icon="faListUl"
                                size={spacing.medium}
                                color={iconColor}
                                />
                            }
                            style={$item}
                            bottomSeparator={false}
                            onPress={() => false}
                        />
                        <ListItem
                        text={translate("tranHistory.pendingParam", {
                          param: pendingDbCount
                        })}
                        LeftComponent={
                            <Icon
                            containerStyle={$iconContainer}
                            icon="faClock"
                            size={spacing.medium}
                            color={showPendingOnly ? activeIconColor : iconColor}
                            />
                        }
                        style={$item}
                        // bottomSeparator={true}
                        onPress={toggleShowPendingOnly}
                        />
                    </>
                }
            />            
            <SectionList
                sections={sections}
                renderSectionHeader={({ section: { title, data } }) => (
                    <>
                        <Text size='xs' preset='formHelper' style={{ textAlign: 'center', color: iconColor}}>{title}</Text>
                        <Card
                            ContentComponent={
                                <>
                                {data.map((item: Transaction, index: number) => (
                                    <TransactionListItem
                                        key={item.id}
                                        transaction={item as Transaction}
                                        isFirst={index === 0}
                                        isTimeAgoVisible={false}
                                        gotoTranDetail={gotoTranDetail}
                                        
                                    />
                                ))}
                                </>
                            }
                            style={$card}
                        />
                    </>
                )}
                renderItem={() => {return null}}
                ListFooterComponent={
                    <>
                    {sections.length > 0 && (
                        <View style={{alignItems: 'center', marginVertical: spacing.small}}>
                            {!showPendingOnly && isAll || showPendingOnly && pendingIsAll ? (
                                <Text tx="tranHistory.listIsComplete" size="xs" />
                            ) : (
                                <Button
                                    preset="secondary"
                                    onPress={addTransactionsToList}
                                    tx="tranHistory.viewMore"
                                    style={{minHeight: 25, paddingVertical: spacing.tiny}}
                                    textStyle={{fontSize: 14}}
                                />
                            )}
                        </View>
                    )}                    
                    </>
                }                        
                onScrollBeginDrag={collapseHeader}
                onStartReached={expandHeader}
                keyExtractor={(item, index) => String(item.id) as string}
                ListEmptyComponent={            
                    <Card
                        ContentComponent={
                            <ListItem
                              leftIcon='faBan'
                              tx={"tranHistory.noTransToShow"}
                            />
                        }
                        style={$card}                
                    />
                }
                style={{maxHeight: spacing.screenHeight * 0.66}}                                
            />    
          {isLoading && <Loading shiftedUp={true} />}
        </View>
        <BottomModal
          isVisible={isDeleteModalVisible ? true : false}
          style={{alignItems: 'stretch'}}            
          ContentComponent={
            <>
                <ListItem
                    tx="tranHistory.deleteExpired"
                    subText={translate("tranHistory.deleteExpiredDesc", {
                      count: expiredDbCount
                    })}
                    leftIcon='faRotate'
                    onPress={() => onDelete(TransactionStatus.EXPIRED)}
                    bottomSeparator={true}
                /> 
                <ListItem
                    tx="tranHistory.deleteErrored"
                    subText={translate("tranHistory.deleteErroredDesc", {
                      count: erroredDbCount
                    })}
                    leftIcon='faBug'                            
                    onPress={() => onDelete(TransactionStatus.ERROR)}
                    bottomSeparator={true}                                    
                />
                <ListItem
                    tx="tranHistory.deleteReverted"
                    subText={translate("tranHistory.deleteRevertedDesc", {
                      count: revertedDbCount
                    })}
                    leftIcon='faBan'                            
                    onPress={() => onDelete(TransactionStatus.REVERTED)}                                    
                />
            </> 
          }
          onBackButtonPress={toggleDeleteModal}
          onBackdropPress={toggleDeleteModal}
        />
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    paddingBottom: spacing.medium,
    height: spacing.screenHeight * 0.20,
}

const $headerCollapsed: TextStyle = {
    alignItems: 'center',
    paddingBottom: spacing.medium,
    height: spacing.screenHeight * 0.08,
}

const $contentContainer: TextStyle = {
  //minHeight: spacing.screenHeight * 0.5,
  //padding: spacing.extraSmall,
}

const $actionCard: ViewStyle = {
  margin: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 2,  
  paddingTop: 0,
}

const $card: ViewStyle = {
  marginHorizontal: spacing.extraSmall,
  marginVertical: spacing.small,  
}


const $iconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}


const $txAmount: TextStyle = {
  fontFamily: typography.primary?.medium,
  alignSelf: 'center',
  marginRight: spacing.small,
}

