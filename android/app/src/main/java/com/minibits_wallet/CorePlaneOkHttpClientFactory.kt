package com.minibits_wallet

import android.util.Log
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.network.OkHttpClientFactory
import okhttp3.OkHttp
import okhttp3.OkHttpClient
import okhttp3.EventListener
import okhttp3.Call
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

class CorePlaneOkHttpClientFactory : OkHttpClientFactory {
    override fun createNewNetworkModuleClient(): OkHttpClient {
        val okHttpVersion = OkHttp.VERSION
        // Log.d("OkHttpFactory", "Using OkHttp version: $okHttpVersion")

        return OkHttpClientProvider.createClientBuilder()
            .dns(CorePlaneOkHttpDNSSelector(CorePlaneOkHttpDNSSelector.IPvMode.IPV4_FIRST))
            /* .eventListener(object : EventListener() {
                override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
                    Log.d("OkHttpNetwork", "Connecting to ${inetSocketAddress.address}")
                }
            })         
            .addInterceptor { chain ->
                val request = chain.request()
                Log.d("OkHttpFactory", "Sending request: ${request.url}")
                val response = chain.proceed(request)
                Log.d("OkHttpFactory", "Received response: ${response.code} from ${response.request.url}")
                response
            } */            
            .connectTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}