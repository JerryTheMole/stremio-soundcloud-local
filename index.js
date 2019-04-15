const pUrl = require('url')

const { config, proxy } = require('internal')

const needle = require('needle')

const defaults = {
	name: 'Soundcloud',
	prefix: 'soundcloud_',
	origin: '',
	endpoint: '',
	icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Antu_soundcloud.svg/150px-Antu_soundcloud.svg.png',
	categories: []
}

const urls = {
	catalog: (skip, limit) => {
		return 'https://api-v2.soundcloud.com/featured_tracks/front?client_id=' + loginData.client_id + '&limit=' + (limit || 20) + '&offset=' + (skip || 0) + '&linked_partitioning=1&app_version=' + loginData.app_version + '&app_locale=' + loginData.app_locale
	},
	search: (query, skip, limit) => {
		return 'https://api-v2.soundcloud.com/search/tracks?q=' + encodeURIComponent(query) + (loginData.sc_a_id ? ('&sc_a_id=' + loginData.sc_a_id) : '') + '&variant_ids=&facet=genre&user_id=' + loginData.user_id + '&client_id=' + loginData.client_id + '&limit=' + (limit || 20) + '&offset=' + (skip || 0) + '&linked_partitioning=1&app_version=' + loginData.app_version + '&app_locale=' + loginData.app_locale
	},
	meta: id => {
		return 'https://api.soundcloud.com/tracks/' + id + '?client_id=' + loginData.client_id
	}
}

const phantom = require('phantom')

let loginData = {}

const headers = {
	'Accept': 'application/json, text/javascript, */*; q=0.01',
	'Origin': 'https://soundcloud.com',
	'Referer': 'https://soundcloud.com/',
	'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36'
}

function toPoster(url, size) {
	return url ? url.replace('-large.', '-t' + size + 'x' + size + '.') : null
}

function toMeta(obj) {
	const poster = obj.artwork_url || ''
	return {
		id: defaults.prefix + (obj.downloadable ? 'down' : 'no') + '_'  + obj.id,
		poster: toPoster(poster, 200),
		posterShape: 'square',
		logo: toPoster(poster, 200),
		background: toPoster(poster, 500),
		name: obj.title,
		type: 'movie'
	}
}

function toStream(reqId) {
	const idParts = reqId.split('_')
	const id = idParts[idParts.length -1]
	const canDownload = !!(idParts[1] == 'down')
	const streams = [
		{
			title: 'Stream',
			url: proxy.addProxy('https://api.soundcloud.com/tracks/' + id + '/stream?client_id=' + loginData.client_id, { headers })
		}
	]
	if (canDownload)
		streams.push({
			title: 'Download',
			externalUrl: 'https://api.soundcloud.com/tracks/' + id + '/download?client_id=' + loginData.client_id
		})
	return streams
}

function getSessionId(cb) {
	phantom.load({
	    clearMemory: true,
	    agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36',
	}, null, null, function(phInstance, page) {

		page.on('onResourceRequested', function(req, netReq) {
			let matches
			if (!loginData.client_id && req.url.includes('?client_id=')) {
				matches = req.url.match(/\?client_id=[a-zA-Z0-9]+/gm)
				if ((matches || []).length)
					loginData.client_id = matches[0].substr(11)
			}
			if (!loginData.app_version && req.url.includes('&app_version=')) {
				matches = req.url.match(/\&app_version=[a-zA-Z0-9]+/gm)
				if ((matches || []).length)
					loginData.app_version = matches[0].substr(13)
			}
			if (!loginData.app_locale && req.url.includes('&app_locale=')) {
				matches = req.url.match(/\&app_locale=[a-zA-Z0-9]+/gm)
				if ((matches || []).length)
					loginData.app_locale = matches[0].substr(12)
			}
			if (!loginData.user_id && req.url.includes('&user_id=')) {
				matches = req.url.match(/\&user_id=[a-zA-Z0-9-]+/gm)
				if ((matches || []).length)
					loginData.user_id = matches[0].substr(9)
			}
			if (!loginData.sc_a_id && req.url.includes('&sc_a_id=')) {
				matches = req.url.match(/\&sc_a_id=[a-zA-Z0-9-]+/gm)
				if ((matches || []).length)
					loginData.sc_a_id = matches[0].substr(9)
			}
		})

        page.open('https://soundcloud.com/search/sounds?q=deep%20house').then(async (status, body) => {
            phantom.close(phInstance, page, () => {})
            if (Object.keys(loginData).length)
            	console.log(defaults.name + ' - Extracter key for api')
        }, function(err) {
        	console.log(err)
            phantom.close(phInstance, page, () => {})
        })
	})
}

getSessionId()

const { addonBuilder, getInterface, getRouter } = require('stremio-addon-sdk')

const builder = new addonBuilder({
	"id": "org.stremio.soundcloud",
	"version": "1.0.0",

	"name": defaults.name,
	"description": "Tracks from Soundcloud",

	"icon": defaults.icon,

	"resources": [
	    "stream", "meta", "catalog"
	],

	"catalogs": [
	    {
	        id: "soundcloud",
	        name: defaults.name,
	        type: "music",
	        extra: [{ name: "search" }]
	    }
	],

	"types": ["music", "movie"],

	"idPrefixes": [ defaults.prefix ]

})

builder.defineCatalogHandler(args => {
    return new Promise((resolve, reject) => {
    	const src = (args.extra || {}).search
    	const cUrl = src ? urls.search(src) : urls.catalog()
    	needle.get(cUrl, { headers }, (err, resp, body) => {
    		if (body && body.collection) {
    			resolve({ metas: body.collection.map(toMeta) })
    		} else {
    			reject(defaults.name + ' - Could not get catalog')
    		}
    	})
    })
})

builder.defineMetaHandler(args => {
    return new Promise((resolve, reject) => {
    	const idParts = args.id.split('_')
    	const id = idParts[idParts.length -1]
    	const cUrl = urls.meta(id)
    	needle.get(cUrl, { headers }, (err, resp, body) => {
    		if (body && body.title)
    			resolve({ meta: toMeta(body) })
    		else
    			reject(defaults.name + ' - Could not get meta')
    	})    	
    })
})

builder.defineStreamHandler(args => {
    return Promise.resolve({ streams: toStream(args.id) })
})

const addonInterface = getInterface(builder)

module.exports = getRouter(addonInterface)
