/**
 * 蜜罐字段名的单一真值（PLAN-002 §1.6 第 1 项）。
 *
 * 客户端表单与服务端 schema 必须用同一个名字，否则蜜罐永远收不到值、这一道
 * 校验静默失效。因此它单独成模块：不引 `node:crypto`、不引 zod，
 * `'use client'` 组件可以安全 import。
 *
 * 取一个业务上说得通的名字（而不是 `honeypot`），让规则型爬虫更难识别；
 * 真实用户看不到也无法聚焦它，提交值恒为空。
 */
export const HONEYPOT_FIELD_NAME = 'contactReference'
