import React, { useEffect, useState } from "react"
import { FlatList, Keyboard, LayoutAnimation, Platform, View, ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"
import { Button, Card} from "../../components"
import { spacing } from "../../theme"
import { MintBalance } from "../../models/Mint"
import { MintUnit } from "../../services/wallet/currency"

import { useStores } from "../../models"
import { log } from "../../services"
import { MintListItem } from "./MintListItem"

export const MintBalanceSelector = observer(function (props: {
    mintBalances: MintBalance[]
    selectedMintBalance?: MintBalance
    unit: MintUnit
    title: string
    confirmTitle: string
    collapsible?: boolean
    onMintBalanceSelect: any
    onCancel: any  
    onMintBalanceConfirm: any
  }) {
  
    const collapsible = props.collapsible === false ? false : true // default true
    const {mintsStore} = useStores()
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
    const [allVisible, setAllVisible] = useState<boolean>(collapsible ? false : true)
    // log.trace('[MintBalanceSelector]', props.selectedMintBalance.mintUrl)
  
    useEffect(() => {
      const keyboardDidShowListener = Keyboard.addListener(
        'keyboardDidShow',
        () => {
          if(Platform.OS === 'android') {
            LayoutAnimation.easeInEaseOut()
          }
          setIsKeyboardVisible(true);
        }
      );
      const keyboardDidHideListener = Keyboard.addListener(
        'keyboardDidHide',
        () => {
          if(Platform.OS === 'android') {
            LayoutAnimation.easeInEaseOut()
          }
          setIsKeyboardVisible(false);
        }
      );
  
      // Clean up listeners
      return () => {
        keyboardDidShowListener.remove();
        keyboardDidHideListener.remove();
      };
    }, [])

    useEffect(() => {    
      if(!props.selectedMintBalance) {
        LayoutAnimation.easeInEaseOut()        
        setAllVisible(true)
      }
    }, [])
  
    const toggleAllVisible = function () {
      LayoutAnimation.easeInEaseOut()
      setAllVisible(!allVisible)
    }
  
    const onMintSelect = function (balance: MintBalance) {
      log.trace('onMintBalanceSelect', balance.mintUrl)
      return props.onMintBalanceSelect(balance)
    }
    
  
    return (
      <View style={{flex: 1}}>
        <Card
          style={props.mintBalances.length > 1 && collapsible ? [$card, {paddingTop: spacing.extraSmall}] : [$card, {paddingVertical: spacing.extraSmall}]}
          label={props.title}                    
          ContentComponent={
            <>
              <FlatList<MintBalance>
                  data={props.mintBalances}
                  renderItem={({ item, index }) => {                       
                      return(
                          <MintListItem
                              key={item.mintUrl}
                              mint={mintsStore.findByUrl(item.mintUrl)!}
                              mintBalance={item}
                              selectedUnit={props.unit}
                              onMintSelect={() => onMintSelect(item)}
                              isSelectable={true}
                              isSelected={!!props.selectedMintBalance ? props.selectedMintBalance.mintUrl === item.mintUrl : false}
                              separator={index === 0 || allVisible === false ? undefined : 'top'}
                              style={(!allVisible && collapsible && props.selectedMintBalance && props.selectedMintBalance.mintUrl !== item.mintUrl) ? {display: 'none'} : {}}                            
                          />
                      )
                  }}
                  keyExtractor={(item) => item.mintUrl} 
                  style={{ flexGrow: 0, maxHeight: spacing.screenHeight * 0.35 }}
                  ListFooterComponent={props.mintBalances.length > 1 && collapsible ? (
                    <View style={{alignItems: 'center'}}>
                      <Button 
                        tx={allVisible ? 'common.hideMore' : 'common.showMore'}
                        onPress={toggleAllVisible}
                        preset='tertiary'
                        textStyle={{fontSize: 14}}
                      />
                    </View>
                  ) : undefined}
              /> 
            </>
          }
        />
        <View style={$bottomContainer}>
          {!isKeyboardVisible && (
          <View style={[$buttonContainer, {marginTop: spacing.large}]}>
              <Button
                text={props.confirmTitle}
                onPress={props.onMintBalanceConfirm}
                style={{marginRight: spacing.medium}}          
              />
              <Button
                preset="secondary"
                tx={'common.cancel'}
                onPress={props.onCancel}
              />
          </View>
          )}
        </View>
      </View>
    )
  })


  const $card: ViewStyle = {
    marginBottom: spacing.small,
    paddingVertical: 0,
  }
  
  
 
  const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
  }
  
 
  const $bottomContainer: ViewStyle = {
      // position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      flex: 1,
      justifyContent: 'flex-end',
      marginBottom: spacing.medium,
      alignSelf: 'stretch',
      // opacity: 0,
    }