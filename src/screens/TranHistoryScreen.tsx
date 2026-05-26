import {observer} from 'mobx-react-lite'
import React, {useState, useEffect, useCallback, useRef} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  SectionList,
  Pressable,
  TextInput,
  Keyboard,
} from 'react-native'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
} from 'react-native-reanimated'
import {useThemeColor, spacing} from '../theme'
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
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {Database, log} from '../services'
import AppError from '../utils/AppError'
import {TransactionListItem} from './Transactions/TransactionListItem'
import { Transaction, TransactionStatus } from '../models/Transaction'
import { translate } from '../i18n'
import { maxTransactionsInHistory } from '../models/TransactionsStore'
import { StaticScreenProps, useFocusEffect, useNavigation } from '@react-navigation/native'

const limit = maxTransactionsInHistory

const SEARCH_PANEL_HEIGHT = 130

type SearchFilters = {
    amount: boolean
    incoming: boolean
    outgoing: boolean
    pending: boolean
}

const emptyFilters: SearchFilters = {
    amount: false,
    incoming: false,
    outgoing: false,
    pending: false,
}

const filterLabelTx: Record<keyof SearchFilters, string> = {
    amount: 'tranHistory_searchFilterAmount',
    incoming: 'tranHistory_searchFilterIncoming',
    outgoing: 'tranHistory_searchFilterOutgoing',
    pending: 'tranHistory_searchFilterPending',
}

const hasAnyFilter = (f: SearchFilters) => f.amount || f.incoming || f.outgoing || f.pending

type Props = StaticScreenProps<{
    showPending?: boolean
}>

export const TranHistoryScreen = observer(function TranHistoryScreen({ route }: Props) {
    const navigation = useNavigation()
    const {transactionsStore} = useStores()
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
      rightIcon: 'faEllipsisVertical',
      onRightPress: () => toggleDeleteModal()
    })

    const searchInputRef = useRef<TextInput>(null)

    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false)
    const [totalDbCount, setTotalDbCount] = useState<number>(0)
    const [expiredDbCount, setExpiredDbCount] = useState<number>(0)
    const [erroredDbCount, setErroredDbCount] = useState<number>(0)
    const [revertedDbCount, setRevertedDbCount] = useState<number>(0)
    const [incomingPendingDbCount, setIncomingPendingDbCount] = useState<number>(0)
    const [isAll, setIsAll] = useState<boolean>(false)

    const [isSearchExpanded, setIsSearchExpanded] = useState<boolean>(false)
    const [searchTerm, setSearchTerm] = useState<string>('')
    const [filters, setFilters] = useState<SearchFilters>(emptyFilters)
    const [committedTerm, setCommittedTerm] = useState<string>('')
    const [committedFilters, setCommittedFilters] = useState<SearchFilters>(emptyFilters)
    const [searchTotalCount, setSearchTotalCount] = useState<number>(0)

    useEffect(() => {
        const init = async () => {
            setIsLoading(true)
            const countByStatus = Database.getTransactionsCount()

            log.trace('Database transaction counts', {countByStatus})

            setExpiredDbCount(countByStatus[TransactionStatus.EXPIRED] || 0)
            setErroredDbCount(countByStatus[TransactionStatus.ERROR] || 0)
            setRevertedDbCount(countByStatus[TransactionStatus.REVERTED] || 0)
            setIncomingPendingDbCount(Database.getIncomingPendingCount())
            setTotalDbCount(countByStatus.total)

            if(countByStatus.total > 0) {
                if(transactionsStore.historyCount === 0) {
                    await transactionsStore.addToHistory(limit, 0, false)
                }

                if(transactionsStore.recentByUnit.length === 0) {
                    await transactionsStore.addRecentByUnit()
                }
            }

            setIsLoading(false)

            if (countByStatus.total <= limit) {
                setIsAll(true)
            }
        }

        init()
        return () => {
            transactionsStore.pruneHistory()
            transactionsStore.pruneRecentWithoutCurrentMint()
        }
    }, [])

    const headerHeight = useSharedValue(spacing.screenHeight * 0.15)
    const searchPanelHeight = useSharedValue(0)

    const collapseHeader = () => {
        headerHeight.value = spacing.screenHeight * 0.08
    }

    const expandHeader = () => {
        headerHeight.value = spacing.screenHeight * 0.15
    }

    const openSearch = useCallback((presetFilters?: Partial<SearchFilters>) => {
        if (presetFilters) {
            const next = {...emptyFilters, ...presetFilters}
            setFilters(next)
            setCommittedFilters(next)
        }
        setIsSearchExpanded(true)
        searchPanelHeight.value = SEARCH_PANEL_HEIGHT
        collapseHeader()
        setTimeout(() => searchInputRef.current?.focus(), 250)
    }, [])

    const toggleFilter = useCallback((key: keyof SearchFilters) => {
        setFilters(prev => {
            const next = {...prev, [key]: !prev[key]}
            // Incoming and Outgoing are mutually exclusive
            if (key === 'incoming' && next.incoming) next.outgoing = false
            if (key === 'outgoing' && next.outgoing) next.incoming = false
            return next
        })
        if (key === 'amount') {
            // Strip non-numerics when switching into amount mode
            setSearchTerm(prev => (filters.amount ? prev : prev.replace(/\D/g, '')))
        }
    }, [filters.amount])

    const onChangeSearchTerm = useCallback((value: string) => {
        setSearchTerm(filters.amount ? value.replace(/\D/g, '') : value)
    }, [filters.amount])

    const runSearchWith = useCallback(async (term: string, f: SearchFilters) => {
        Keyboard.dismiss()
        setCommittedTerm(term)
        setCommittedFilters(f)
        setIsSearchExpanded(false)
        searchPanelHeight.value = 0
        expandHeader()
        setIsLoading(true)
        try {
            const total = Database.searchTransactionsCount(term, f)
            setSearchTotalCount(total)
            transactionsStore.removeAllHistory()
            await transactionsStore.searchHistory(term, f, limit, 0)
            setIsAll(transactionsStore.historyCount >= total)
        } catch (e: any) {
            handleError(e)
            return
        }
        setIsLoading(false)
    }, [transactionsStore])

    const runSearch = useCallback(() => {
        runSearchWith(searchTerm, filters)
    }, [searchTerm, filters, runSearchWith])

    const clearSearch = useCallback(async () => {
        Keyboard.dismiss()
        setSearchTerm('')
        setFilters(emptyFilters)
        const hadCommitted = committedTerm.length > 0 || hasAnyFilter(committedFilters)
        setCommittedTerm('')
        setCommittedFilters(emptyFilters)
        setSearchTotalCount(0)
        setIsSearchExpanded(false)
        searchPanelHeight.value = 0
        expandHeader()
        if (hadCommitted) {
            setIsLoading(true)
            try {
                transactionsStore.removeAllHistory()
                await transactionsStore.addToHistory(limit, 0, false)
                setIsAll(transactionsStore.historyCount >= totalDbCount)
            } catch (e: any) {
                handleError(e)
                return
            }
            setIsLoading(false)
        }
    }, [committedTerm, committedFilters, totalDbCount, transactionsStore])

    const initFilter = useCallback(() => {
        if(route.params && route.params.showPending) {
            const preset = {...emptyFilters, pending: true}
            setFilters(preset)
            runSearchWith('', preset)
            //@ts-ignore
            navigation.setParams({ showPending: undefined })
        }
    }, [route.params, runSearchWith, navigation])

    useFocusEffect(initFilter)

    const toggleDeleteModal = () => {
        setIsDeleteModalVisible(previousState => !previousState)
    }

    const addTransactionsToList = async function () {
        const isSearching = committedTerm.length > 0 || hasAnyFilter(committedFilters)
        setIsLoading(true)
        try {
            if (isSearching) {
                await transactionsStore.searchHistory(
                    committedTerm,
                    committedFilters,
                    limit,
                    transactionsStore.historyCount,
                )
                if (transactionsStore.historyCount >= searchTotalCount) {
                    setIsAll(true)
                }
            } else {
                await transactionsStore.addToHistory(limit, transactionsStore.historyCount, false)
                if (transactionsStore.historyCount >= totalDbCount) {
                    setIsAll(true)
                }
            }
            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }

    const onDelete = function (status: TransactionStatus) {
        try {
            toggleDeleteModal()
            setIsLoading(true)
            transactionsStore.deleteByStatus(status)
            const countByStatus = Database.getTransactionsCount()

            setExpiredDbCount(countByStatus[TransactionStatus.EXPIRED] || 0)
            setErroredDbCount(countByStatus[TransactionStatus.ERROR] || 0)
            setRevertedDbCount(countByStatus[TransactionStatus.REVERTED] || 0)
            setIncomingPendingDbCount(Database.getIncomingPendingCount())
            setTotalDbCount(countByStatus.total)
            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }

    const onDeleteIncomingPending = function () {
        try {
            toggleDeleteModal()
            setIsLoading(true)
            transactionsStore.deleteIncomingPending()
            const countByStatus = Database.getTransactionsCount()

            setExpiredDbCount(countByStatus[TransactionStatus.EXPIRED] || 0)
            setErroredDbCount(countByStatus[TransactionStatus.ERROR] || 0)
            setRevertedDbCount(countByStatus[TransactionStatus.REVERTED] || 0)
            setIncomingPendingDbCount(Database.getIncomingPendingCount())
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

    const animatedHeader = useAnimatedStyle(() => ({
        height: withTiming(headerHeight.value, { duration: 300 }),
    }))

    const animatedSearchPanel = useAnimatedStyle(() => ({
        height: withTiming(searchPanelHeight.value, { duration: 250 }),
        overflow: 'hidden',
    }))

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const activeIconColor = useThemeColor('button')
    const headerTitle = useThemeColor('headerTitle')
    const inputBg = useThemeColor('background')
    const inputText = useThemeColor('text')

    const sections = Object.keys(transactionsStore.historyByTimeAgo).map((timeAgo) => ({
        title: timeAgo,
        data: transactionsStore.historyByTimeAgo[timeAgo],
    }))

    return (
      <Screen contentContainerStyle={$screen}>
        <Animated.View style={[animatedHeader, $headerContainer, {backgroundColor: headerBg}]}>
            <Text preset="heading" tx="tranHistoryScreen_title" style={{color: headerTitle}} />
        </Animated.View>

        <View style={$contentContainer}>
            <Card
                style={$actionCard}
                ContentComponent={
                    <>
                        <ListItem
                            text={(() => {
                                const isSearching = committedTerm.length > 0 || hasAnyFilter(committedFilters)
                                return translate(
                                    isSearching ? "tranHistory_showingPaginationResults" : "tranHistory_showingPaginationTotal",
                                    {
                                        amount: transactionsStore.historyCount,
                                        total: isSearching ? searchTotalCount : totalDbCount,
                                    },
                                )
                            })()}
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
                        {(() => {
                            const hasCommitted = committedTerm.length > 0 || hasAnyFilter(committedFilters)
                            const showRow = isSearchExpanded || hasCommitted
                            if (!showRow) {
                                return (
                                    <ListItem
                                        tx="tranHistory_search"
                                        LeftComponent={
                                            <Icon
                                                containerStyle={$iconContainer}
                                                icon="faMagnifyingGlass"
                                                size={spacing.medium}
                                                color={iconColor}
                                            />
                                        }
                                        style={$item}
                                        onPress={() => openSearch()}
                                    />
                                )
                            }
                            const activeFilterKeys = (Object.keys(committedFilters) as Array<keyof SearchFilters>)
                                .filter(k => committedFilters[k])
                            const showClear = isSearchExpanded
                                ? searchTerm.length > 0
                                : (committedTerm.length > 0 || activeFilterKeys.length > 0)
                            return (
                                <View style={$searchRow}>
                                    <View style={[$searchRowMain, {backgroundColor: inputBg}]}>
                                        <Icon
                                            icon="faMagnifyingGlass"
                                            size={spacing.medium}
                                            color={isSearchExpanded ? activeIconColor : iconColor}
                                            containerStyle={$searchRowLeadingIcon}
                                        />
                                        {isSearchExpanded ? (
                                            <TextInput
                                                ref={searchInputRef}
                                                value={searchTerm}
                                                onChangeText={onChangeSearchTerm}
                                                placeholder={translate("tranHistory_searchPlaceholder")}
                                                placeholderTextColor={iconColor as string}
                                                returnKeyType="search"
                                                onSubmitEditing={runSearch}
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                                spellCheck={false}
                                                keyboardType={filters.amount ? 'numeric' : 'default'}
                                                style={[$searchRowInput, {color: inputText}]}
                                            />
                                        ) : (
                                            <Pressable onPress={() => openSearch()} style={$searchRowTags}>
                                                {committedTerm.length > 0 && (
                                                    <View style={[$tag, {backgroundColor: activeIconColor}]}>
                                                        <Text text={committedTerm} size='xs' style={$tagText} />
                                                    </View>
                                                )}
                                                {activeFilterKeys.map(k => (
                                                    <View key={k} style={[$tag, {backgroundColor: activeIconColor}]}>
                                                        <Text tx={filterLabelTx[k] as any} size='xs' style={$tagText} />
                                                    </View>
                                                ))}
                                            </Pressable>
                                        )}
                                        {showClear && (
                                            <Pressable
                                                onPress={clearSearch}
                                                hitSlop={8}
                                                style={$searchRowClearIcon}
                                                accessibilityRole="button"
                                            >
                                                <Icon icon="faXmark" size={spacing.medium} color={iconColor} />
                                            </Pressable>
                                        )}
                                    </View>
                                </View>
                            )
                        })()}
                        <Animated.View style={animatedSearchPanel}>
                            <View style={$panelInner}>
                                <View style={$chipsRow}>
                                    <FilterChip
                                        labelTx="tranHistory_searchFilterAmount"
                                        selected={filters.amount}
                                        onPress={() => toggleFilter('amount')}
                                    />
                                    <FilterChip
                                        labelTx="tranHistory_searchFilterIncoming"
                                        selected={filters.incoming}
                                        onPress={() => toggleFilter('incoming')}
                                    />
                                    <FilterChip
                                        labelTx="tranHistory_searchFilterOutgoing"
                                        selected={filters.outgoing}
                                        onPress={() => toggleFilter('outgoing')}
                                    />
                                    <FilterChip
                                        labelTx="tranHistory_searchFilterPending"
                                        selected={filters.pending}
                                        onPress={() => toggleFilter('pending')}
                                    />
                                </View>
                                {(() => {
                                    const noInput = searchTerm.length === 0 && !hasAnyFilter(filters)
                                    if (noInput) {
                                        return (
                                            <Button
                                                preset="secondary"
                                                tx="tranHistory_searchClose"
                                                onPress={clearSearch}
                                                style={$searchButton}
                                            />
                                        )
                                    }
                                    const isAmountInvalid = filters.amount && searchTerm.length === 0
                                    return (
                                        <Button
                                            preset="default"
                                            tx="tranHistory_searchAction"
                                            LeftAccessory={(props) => (
                                                <Icon
                                                    icon="faMagnifyingGlass"
                                                    size={spacing.medium}
                                                    color={'white'}
                                                    containerStyle={props.style}
                                                />
                                            )}
                                            disabled={isAmountInvalid}
                                            onPress={runSearch}
                                            style={[$searchButton, isAmountInvalid && {opacity: 0.5}]}
                                        />
                                    )
                                })()}
                            </View>
                        </Animated.View>
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
                        <View style={{alignItems: 'center'}}>
                            {isAll ? (
                                <Text tx="tranHistory_listIsComplete" size="xs" />
                            ) : (
                                <Button
                                    preset="secondary"
                                    onPress={addTransactionsToList}
                                    tx="tranHistory_viewMore"
                                    style={{minHeight: 25, paddingVertical: spacing.tiny}}
                                    textStyle={{fontSize: 14}}
                                />
                            )}
                        </View>
                    )}
                    </>
                }
                onEndReached={collapseHeader}
                onStartReached={expandHeader}
                stickySectionHeadersEnabled={false}
                keyExtractor={(item, index) => String(item.id) as string}
                ListEmptyComponent={
                    <Card
                        ContentComponent={
                            <ListItem
                              leftIcon='faBan'
                              tx={"tranHistory_noTransToShow"}
                            />
                        }
                        style={$card}
                    />
                }
                style={{maxHeight: spacing.screenHeight * 0.57}}
            />
          {isLoading && <Loading shiftedUp={true} />}
        </View>
        <BottomModal
          isVisible={isDeleteModalVisible ? true : false}
          style={{alignItems: 'stretch'}}
          ContentComponent={
            <>
                <ListItem
                    tx="tranHistory_deleteIncomingPending"
                    subText={translate("tranHistory_deleteIncomingPendingDesc", {
                      count: incomingPendingDbCount
                    })}
                    leftIcon='faArrowDown'
                    onPress={onDeleteIncomingPending}
                    bottomSeparator={true}
                />
                <ListItem
                    tx="tranHistory_deleteExpired"
                    subText={translate("tranHistory_deleteExpiredDesc", {
                      count: expiredDbCount
                    })}
                    leftIcon='faRotate'
                    onPress={() => onDelete(TransactionStatus.EXPIRED)}
                    bottomSeparator={true}
                />
                <ListItem
                    tx="tranHistory_deleteErrored"
                    subText={translate("tranHistory_deleteErroredDesc", {
                      count: erroredDbCount
                    })}
                    leftIcon='faBug'
                    onPress={() => onDelete(TransactionStatus.ERROR)}
                    bottomSeparator={true}
                />
                <ListItem
                    tx="tranHistory_deleteReverted"
                    subText={translate("tranHistory_deleteRevertedDesc", {
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

type FilterChipProps = {
    labelTx: string
    selected: boolean
    onPress: () => void
}

const FilterChip = function FilterChip({labelTx, selected, onPress}: FilterChipProps) {
    const activeBg = useThemeColor('button')
    const inactiveBorder = useThemeColor('border')
    const inactiveText = useThemeColor('textDim')

    return (
        <Pressable
            onPress={onPress}
            style={({pressed}) => [
                $chip,
                selected
                    ? {backgroundColor: activeBg, borderColor: activeBg}
                    : {backgroundColor: 'transparent', borderColor: inactiveBorder as any},
                pressed && {opacity: 0.7},
            ]}
            accessibilityRole="button"
            accessibilityState={{selected}}
        >
            <Text
                tx={labelTx as any}
                size="xs"
                style={{color: selected ? 'white' : (inactiveText as any)}}
            />
        </Pressable>
    )
}

const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    paddingBottom: spacing.medium,
    height: spacing.screenHeight * 0.15,
}

const $contentContainer: TextStyle = {}

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

const $panelInner: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingTop: spacing.tiny,
  paddingBottom: spacing.small,
}

const $searchRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'stretch',
  marginHorizontal: spacing.micro,
  marginVertical: spacing.tiny,
}

const $searchRowMain: ViewStyle = {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'center',
  paddingLeft: spacing.small,
  paddingRight: spacing.small,
  minHeight: verticalScale(50),
  borderRadius: spacing.extraSmall,
}

const $searchRowLeadingIcon: ViewStyle = {
  marginRight: spacing.small,
}

const $searchRowInput: TextStyle = {
  flex: 1,
  fontSize: verticalScale(16),
  padding: 0,
  margin: 0,
  includeFontPadding: false,
  textAlignVertical: 'center',
}

const $searchRowTags: ViewStyle = {
  flex: 1,
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  alignContent: 'center',
  alignSelf: 'stretch',
}

const $tag: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingVertical: spacing.micro,
  borderRadius: spacing.medium,
  marginRight: spacing.tiny,
  marginVertical: spacing.micro,
}

const $tagText: TextStyle = {
  color: 'white',
}

const $searchRowClearIcon: ViewStyle = {
  paddingHorizontal: spacing.tiny,
  alignSelf: 'center',
  marginLeft: spacing.tiny,
}

const $chipsRow: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  marginBottom: spacing.small,
}

const $chip: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingVertical: spacing.tiny,
  borderRadius: spacing.medium,
  borderWidth: 1,
  marginRight: spacing.tiny,
  marginBottom: spacing.tiny,
}

const $searchButton: ViewStyle = {
  alignSelf: 'center',
  minHeight: 36,
  paddingVertical: spacing.tiny,
  paddingHorizontal: spacing.medium,
}
