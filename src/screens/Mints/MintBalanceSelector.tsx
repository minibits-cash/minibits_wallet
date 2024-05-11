import React, { useEffect, useState } from "react"
import { FlatList, Keyboard, LayoutAnimation, View, ViewStyle } from "react-native"
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
    onMintBalanceSelect: any
    onCancel: any  
    onMintBalanceConfirm: any
  }) {
  
    const {mintsStore} = useStores()
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
    const [allVisible, setAllVisible] = useState<boolean>(false)
    // log.trace('[MintBalanceSelector]', props.selectedMintBalance.mintUrl)
  
    useEffect(() => {
      const keyboardDidShowListener = Keyboard.addListener(
        'keyboardDidShow',
        () => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
          setIsKeyboardVisible(true);
        }
      );
      const keyboardDidHideListener = Keyboard.addListener(
        'keyboardDidHide',
        () => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
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
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)        
        setAllVisible(true)
      }
    }, [])
  
    const toggleAllVisible = function () {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      setAllVisible(!allVisible)
    }
  
    const onMintSelect = function (balance: MintBalance) {
      log.trace('onMintBalanceSelect', balance.mintUrl)
      return props.onMintBalanceSelect(balance)
    }
    
  
    return (
      <View style={{flex: 1}}>
        <Card
          style={$card}
          heading={props.title}
          headingStyle={{textAlign: 'center', padding: spacing.small}}
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
                              separator={'top'}
                              style={(!allVisible && props.selectedMintBalance && props.selectedMintBalance.mintUrl !== item.mintUrl) ? {display: 'none'} : {}}                            
                          />
                      )
                  }}
                  keyExtractor={(item) => item.mintUrl} 
                  style={{ flexGrow: 0, maxHeight: spacing.screenHeight * 0.35 }}
                  ListFooterComponent={props.mintBalances.length > 1 ? (
                    <View>
                      <Button 
                        text={`${allVisible ? 'Hide' : 'Show'} more`} 
                        onPress={toggleAllVisible}
                        preset='tertiary'
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