"use strict";

const fetch = require("node-fetch");
const cheerio = require("cheerio");
const {validate} = require("jsonschema");

const Recipe = require("./Recipe");
const recipeSchema = require("./RecipeSchema.json");
const {createInvalidArgumentTypeError} = require("mocha/lib/errors");

/**
 * Abstract Class which all scrapers inherit from
 */
class BaseScraper {
  constructor(url, subUrl = "") {
    this.url = url;
    this.subUrl = subUrl;
  }

  async checkServerResponse() {
    try {
      const res = await fetch(this.url);

      return res.ok; // res.status >= 200 && res.status < 300
    } catch (e) {
      console.log(e)
      return false;
    }
  }

  /**
   * Checks if the url has the required sub url
   */
  checkUrl() {
    if (!this.url.includes(this.subUrl)) {
      throw new Error(`url provided must include '${this.subUrl}'`);
    }
  }

  /**
   * Builds a new instance of Recipe
   */
  createRecipeObject() {
    this.recipe = new Recipe();
  }

  defaultError() {
    throw new Error("No recipe found on page");
  }

  /**
   * look for LD+JOSN script in the web page.
   * @param {object} $ - a cheerio object representing a DOM
   * @returns {boolean} - if exist, set recipe data and return true, else - return false.
   */
  defaultLD_JOSN($) {
    const jsonLDs = Object.values($("script[type='application/ld+json']"));
    let isRecipeSchemaFound = false;

    jsonLDs.forEach(jsonLD => {
      if (jsonLD && jsonLD.children && Array.isArray(jsonLD.children)) {
        jsonLD.children.forEach(el => {
          if (el.data) {

            const jsonRaw = el.data;
            const result = JSON.parse(jsonRaw);
            let recipe;

            if (result['@graph'] && Array.isArray(result['@graph'])) {
              result['@graph'].forEach(g => {
                if ((g['@type'] === 'Recipe') || (Array.isArray(g['@type']) && g['@type'].includes('Recipe'))) {
                  recipe = g;
                }
              })
            }

            if ((result['@type'] === 'Recipe') || (Array.isArray(result['@type']) && result['@type'].includes('Recipe'))) {
              recipe = result;
            }

            if (recipe) {
              try {
                // name
                this.recipe.name = BaseScraper.HtmlDecode($, recipe.name);

                // description
                if (recipe.description) {
                  this.recipe.description = BaseScraper.HtmlDecode($, recipe.description);
                } else {
                  this.defaultSetDescription($);
                }

                // image
                if (recipe.image) {
                  if (recipe.image["@type"] === "ImageObject" && recipe.url) {
                    this.recipe.image = recipe.image.url;
                  } else if (typeof recipe.image === "string") {
                    this.recipe.image = recipe.image;
                  } else if (Array.isArray(recipe.image)) {
                    const image = recipe.image[0];
                    if (image["@type"] === "ImageObject") {
                      this.recipe.image = image.url;
                    } else if (typeof image === "string") {
                      this.recipe.image = image;
                    }
                  }
                } else if(recipe.thumbnailUrl) {
                  if (typeof recipe.thumbnailUrl === "string") {
                    this.recipe.image = recipe.thumbnailUrl;
                  } else if (Array.isArray(recipe.thumbnailUrl)) {
                    this.recipe.image = recipe.thumbnailUrl[0];
                  }

                } else {
                  this.defaultSetImage($);
                }

                // tags
                this.recipe.tags = new Set();
                if (recipe.keywords) {
                  if (typeof recipe.keywords === "string") {
                    recipe.keywords.split(',').forEach(keyword => {
                      this.recipe.tags.add(keyword.trim());
                    });
                  } else if (Array.isArray(recipe.keywords)) {
                    recipe.keywords.forEach(keyword => {
                      this.recipe.tags.add(keyword);
                    });
                  }
                }

                if (recipe.recipeCuisine) {
                  if (typeof recipe.recipeCuisine === "string") {
                    this.recipe.tags.add(recipe.recipeCuisine)
                  } else if (Array.isArray(recipe.recipeCuisine)) {
                    recipe.recipeCuisine.forEach(cuisine => {
                      this.recipe.tags.add(cuisine);
                    });
                  }
                }

                if (recipe.recipeCategory) {
                  if (typeof recipe.recipeCategory === "string") {
                    if (recipe.recipeCategory.indexOf('|') >= 0) {
                      recipe.recipeCategory = recipe.recipeCategory.split('|');
                    } else {
                      recipe.recipeCategory = recipe.recipeCategory.split(',');
                    }
                  }

                  if (Array.isArray(recipe.recipeCategory)) {
                    recipe.recipeCategory.forEach(category => {
                      this.recipe.tags.add(category);
                    });
                  }
                }

                this.recipe.tags = Array.from(this.recipe.tags).map(i => BaseScraper.HtmlDecode($, i)).filter(tag => {
                  if (tag) {
                    return tag;
                  }
                });

                // ingredients
                if (Array.isArray(recipe.recipeIngredient)) {
                  this.recipe.ingredients = recipe.recipeIngredient.map(i => BaseScraper.HtmlDecode($, i));
                } else if (typeof recipe.recipeIngredient === "string") {
                  this.recipe.ingredients = recipe.recipeIngredient.split(",").map(i => BaseScraper.HtmlDecode($, i.trim()));
                }

                // instructions (may be string, array of strings, or object of sectioned instructions)
                this.recipe.instructions = new Set();
                this.recipe.sectionedInstructions = new Set();

                if (recipe.recipeInstructions &&
                  recipe.recipeInstructions["@type"] === "ItemList" &&
                  recipe.recipeInstructions.itemListElement) {

                  recipe.recipeInstructions.itemListElement.forEach(section => {
                    section.itemListElement.map(i => BaseScraper.HtmlDecode($, i.text)).forEach(instruction => {
                      this.recipe.instructions.add(instruction);
                    });

                    section.itemListElement.forEach(i => {
                      this.recipe.sectionedInstructions.add({
                        sectionTitle: section.name,
                        text: BaseScraper.HtmlDecode($, i.text),
                        image: i.image || ''
                      })
                    });
                  });
                } else if (Array.isArray(recipe.recipeInstructions)) {
                  recipe.recipeInstructions.forEach(instructionStep => {
                    if (instructionStep["@type"] === "HowToStep") {
                      this.recipe.instructions.add(BaseScraper.HtmlDecode($, instructionStep.text));
                      this.recipe.sectionedInstructions.add({
                        sectionTitle: instructionStep.name || '',
                        text: BaseScraper.HtmlDecode($, instructionStep.text),
                        image: instructionStep.image || ''
                      })
                    } else if (instructionStep["@type"] === "HowToSection") {
                      if (instructionStep.itemListElement) {
                        instructionStep.itemListElement.forEach(step => {
                          this.recipe.instructions.add(BaseScraper.HtmlDecode($, step.text));

                          this.recipe.sectionedInstructions.add({
                            sectionTitle: instructionStep.name,
                            text: BaseScraper.HtmlDecode($, step.text),
                            image: step.image || ''
                          })
                        });
                      }
                    } else if (typeof instructionStep === "string") {
                      this.recipe.instructions.add(BaseScraper.HtmlDecode($, instructionStep));
                    }
                  });
                } else if (typeof recipe.recipeInstructions === "string") {
                  this.recipe.instructions = [BaseScraper.HtmlDecode($, recipe.recipeInstructions)]
                }

                this.recipe.sectionedInstructions = Array.from(this.recipe.sectionedInstructions);
                this.recipe.instructions = Array.from(this.recipe.instructions);

                // prep time
                if (recipe.prepTime) {
                  this.recipe.time.prep = BaseScraper.parsePTTime(recipe.prepTime);
                }

                // cook time
                if (recipe.cookTime) {
                  this.recipe.time.cook = BaseScraper.parsePTTime(recipe.cookTime);
                }

                // total time
                if (recipe.totalTime) {
                  this.recipe.time.total = BaseScraper.parsePTTime(recipe.totalTime);
                }

                // servings
                if (Array.isArray(recipe.recipeYield)) {
                  this.recipe.servings = recipe.recipeYield[0];
                } else if (typeof recipe.recipeYield === "string") {
                  this.recipe.servings = recipe.recipeYield;
                }

                isRecipeSchemaFound = true;
              } catch (e) {
                console.log(e);
              }
            }
          }
        });
      }
    });

    return isRecipeSchemaFound;
  }

  /**
   * @param {object} $ - a cheerio object representing a DOM
   * @returns {string|null} - if found, an image url
   */
  defaultSetImage($) {
    this.recipe.image =
      $("meta[property='og:image']").attr("content") ||
      $("meta[name='og:image']").attr("content") ||
      $("meta[itemprop='image']").attr("content");
  }

  /**
   * @param {object} $ - a cheerio object representing a DOM
   * if found, set recipe description
   */
  defaultSetDescription($) {
    const description =
      $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      $("meta[name='twitter:description']").attr("content");

    this.recipe.description = description ? description.replace(/\n/g, " ").trim() : '';
  }

  /**
   * Fetches html from url
   * @returns {object} - Cheerio instance
   */
  async fetchDOMModel() {
    try {
      const res = await fetch(this.url);
      const html = await res.text();
      return cheerio.load(html);
    } catch (err) {
      throw err;
      // this.defaultError();
    }
  }

  /**
   * Handles the workflow for fetching a recipe
   * @returns {object} - an object representing the recipe
   */
  async fetchRecipe() {
    this.checkUrl();
    try {
      const $ = await this.fetchDOMModel();
      this.createRecipeObject();
      this.scrape($);
    } catch (e) {
      // throw e;
      console.log('ERROR CREATING RECIPE OBJECT', e.message);
      this.defaultError();
    }

    return this.validateRecipe();
  }

  /**
   * Abstract method
   * @param {object} $ - cheerio instance
   * @returns {object} - an object representing the recipe
   */
  scrape($) {
    this.defaultLD_JOSN($);
  }

  textTrim(el) {
    return el.text().trim();
  }

  static HtmlDecode($, s) {
    const res = $('<div>').html(s).text() || "";

    return res.trim()
      .replace(/amp;/gm, '')
      .replace(/(?=\[caption).*?(?<=\[ caption\])/g, '') // removes short-codes [caption.*[ caption]
      .replace(/\n/g, "");
  }

  /**
   * Validates scraped recipes against defined recipe schema
   * @returns {object} - an object representing the recipe
   */
  validateRecipe() {
    let res = validate(this.recipe, recipeSchema);


    if (!res.valid) {
      // console.log(res.errors);
      this.defaultError();
    }
    return this.recipe;
  }

  static parsePTTime(ptTime) {
    ptTime = ptTime.replace('PT', '');
    ptTime = ptTime.replace('H', ' hours ');
    ptTime = ptTime.replace('M', ' minutes ');
    ptTime = ptTime.replace('S', ' seconds');

    return ptTime.trim();
  }
}

module.exports = BaseScraper;
