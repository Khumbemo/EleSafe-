package org.hatialert.client

import java.io.IOException

/** Anything that stopped a request. */
sealed class HatiException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The server answered with an error. [message] is the server's own text, written
 * for people (e.g. "That phone number and PIN don't match."); [field] names the
 * form field it is about, when there is one.
 */
class ApiException(val status: Int, message: String, val field: String? = null, cause: Throwable? = null) : HatiException(message, cause) {
    val isUnauthorized get() = status == 401
    val isForbidden get() = status == 403
    override fun toString() = "ApiException($status, $message, field=$field)"
}

/** No answer: no signal, server down, wrong address, timeout. */
class NetworkException(message: String, cause: IOException) : HatiException(message, cause)
