const db = require('./db')
const uuid = require('uuid')
const _ = require('lodash/fp')
const BN = require('./bn')
const anonymous = require('../lib/constants').anonymousCustomer
const NUM_RESULTS = 20
const camelize = require('camelize')

function add (customer) {
  const sql = 'insert into customers (id, phone, phone_at) values ($1, $2, now()) returning *'
  return db.one(sql, [uuid.v4(), customer.phone])
}

function get (phone) {
  const sql = 'select id, phone from customers where phone=$1'
  return db.oneOrNone(sql, [phone])
  .then(customer => {
    if (!customer) return
    return getDailyVolume(customer.id).then(dailyVolume => {
      return _.set('dailyVolume', dailyVolume, customer)
    })
  })
}

/**
 * Patch Customer
 * Note: Currently patching only authorized_verified field
 *
 * @param {string} id Customer's id
 * @param {object} values Values to patch
 * @returns {object} Updated customer
 */
function patch (id, values) {
  const sql = 'update customers set authorized_override=$2 where id=$1 returning *'
  return db.oneOrNone(sql, [id, values.authorized_override])
}

function getById (id) {
  const sql = 'select * from customers where id=$1'
  return db.oneOrNone(sql, [id])
  .then(customer => {
    return (customer) ? format(customer) : null
  })
}

function getDailyVolume (id) {
  return Promise.all([
    db.one(`select coalesce(sum(fiat), 0) as total from cash_in_txs 
           where customer_id=$1 
           and created > now() - interval '1 day'`, [id]),
    db.one(`select coalesce(sum(fiat), 0) as total from cash_out_txs 
           where customer_id=$1 
           and created > now() - interval '1 day'`, [id])
  ]).then(([cashInTotal, cashOutTotal]) => {
    return BN(cashInTotal.total).add(cashOutTotal.total)
  })
}

/**
 * Format and populate fields
 * for customer record
 *
 * @function format
 *
 * @param {object} customer Customer object
 * @returns {object} Customer camelized & populated with computed fields
 */
function format (customer) {
  /**
   * Populate with status field
   *
   */
  const status = _.maxBy('value', [{
    label: 'Phone',
    value: customer.phone_at
  }, {
    label: 'ID card',
    value: customer.id_card_at
  }, {
    label: 'Front facing camera',
    value: customer.front_facing_cam_at
  }, {
    label: 'ID card image',
    value: customer.id_card_image_at
  }])
  customer.status = status.label

  return camelize(customer)
}

/**
 * Query all customers
 *
 * Add status as computed column,
 * which will indicate the name of the latest
 * compliance verfication completed by user.
 *
 * @returns {array} Array of customers populated with status field
 */
function batch () {
  const sql = `select * from customers 
  where id != $1
  order by created desc limit $2`
  return db.any(sql, [ anonymous.uuid, NUM_RESULTS ])
  .then(customers => {
    return _.map(customer => format(customer), customers)
  })
}

module.exports = { add, get, batch, getById, patch}