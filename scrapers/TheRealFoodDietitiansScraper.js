"use strict";

const PuppeteerScraper = require("../helpers/PuppeteerScraper");

/**
 * Class for scraping therealfooddrs.com
 * @extends PuppeteerScraper
 */
class TheRealFoodDietitiansScraper extends PuppeteerScraper {
  constructor(url) {
    super(url, "therealfooddietitians.com/");
  }

  scrape($) {
    this.defaultLD_JOSN($);
    // this.defaultSetImage($);
    this.defaultSetDescription($);
    // const { ingredients, instructions, time } = this.recipe;
    // this.recipe.name = $(".tasty-recipes-entry-header h2")
    //   .first()
    //   .text();

    console.log('NAME', this.recipe.name);

    // $(".tasty-recipes-instructions")
    //   .find("h4, li")
    //   .each((i, el) => {
    //     this.recipe.instructions.add(
    //       $(el)
    //         .text()
    //         .replace(/\s\s+/g, "")
    //     );
    //   });

    // this.recipe.tags = this.recipe.tags.split("|")
    //   .map(x => x.trim());

    this.recipe.time.prep = $(".tasty-recipes-prep-time").text();
    this.recipe.time.cook = $(".tasty-recipes-cook-time").text();
    this.recipe.time.total = $(".tasty-recipes-total-time").text();

    this.recipe.servings = $(".tasty-recipes-yield")
      .children("span")
      .first()
      .text();
  }
}

module.exports = TheRealFoodDietitiansScraper;
