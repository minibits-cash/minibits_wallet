package com.minibits_wallet

import okhttp3.Dns
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import android.util.Log

class CorePlaneOkHttpDNSSelector(private val mode: IPvMode) : Dns {

    enum class IPvMode(val code: String) {
        SYSTEM("system"),
        IPV6_FIRST("ipv6"),
        IPV4_FIRST("ipv4"),
        IPV6_ONLY("ipv6only"),
        IPV4_ONLY("ipv4only");

        companion object {
            @JvmStatic
            fun fromString(ipMode: String): IPvMode =
                values().find { it.code == ipMode } ?: throw IllegalArgumentException("Unknown value: $ipMode")
        }
    }

    override fun lookup(hostname: String): List<InetAddress> {
        var addresses = try {
            Dns.SYSTEM.lookup(hostname)
        } catch (e: Exception) {
            Log.e("OkHttpFactory", "DNS lookup failed for $hostname", e)
            throw e
        }

        // Log the raw DNS result before filtering
        // Log.d("OkHttpFactory", "Raw DNS lookup for $hostname -> ${addresses.joinToString(", ")}")

        val sortedAddresses = when (mode) {
            IPvMode.IPV6_FIRST -> addresses.sortedByDescending { it is Inet6Address } // IPv6 before IPv4
            IPvMode.IPV4_FIRST -> addresses.sortedByDescending { it is Inet4Address } // IPv4 before IPv6
            IPvMode.IPV6_ONLY -> addresses.filter { it is Inet6Address }
            IPvMode.IPV4_ONLY -> addresses.filter { it is Inet4Address }
            IPvMode.SYSTEM -> addresses
        }

        if (sortedAddresses.isEmpty()) {
            throw RuntimeException("No resolved sortedAddresses for $hostname with mode $mode")
        }

        // Log.d("OkHttpFactory", "DNS lookup for $hostname -> ${sortedAddresses.joinToString(", ")}")

        return sortedAddresses
    }
}
